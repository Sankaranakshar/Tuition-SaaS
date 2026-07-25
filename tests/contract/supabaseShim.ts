import { query } from "./pgliteBackend.ts";

// Minimal stand-in for the `@supabase/supabase-js` service-role client
// (`server/supabaseAdmin.ts`), backed directly by PGlite instead of a real
// PostgREST endpoint. Only implements the exact query-builder shapes this
// codebase's server routes actually use (grepped, not guessed) — `.from()`,
// `.select()`, `.insert()`, `.update()`, `.upsert()`, `.eq()` (chainable up
// to twice), `.limit()`, `.maybeSingle()`, `.single()`, and a bare `await`
// on the builder itself (supabase-js builders are thenables). If a route
// starts using a shape not listed here, this throws loudly rather than
// silently returning wrong data — extend it, don't work around it.
//
// One deliberate special case: `organization_members` embeds
// `organizations(status)` in its select — the one nested-resource query in
// the codebase (server/middleware/auth.ts, runs on every authenticated
// request). Handled with an explicit LEFT JOIN rather than a generic embed
// parser, since it's the only caller.

type Row = Record<string, any>;

function toParam(value: unknown): unknown {
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  return value;
}

function buildFrom(table: string) {
  let mode: "select" | "insert" | "update" | "upsert" | null = null;
  let selectCols = "*";
  let rows: Row[] | null = null;
  let updateObj: Row | null = null;
  let onConflict: string | null = null;
  const eqConds: [string, unknown][] = [];
  let limitN: number | null = null;
  let singleMode: "maybeSingle" | "single" | null = null;

  async function exec(): Promise<{ data: any; error: any }> {
    try {
      let sql: string;
      const params: unknown[] = [];

      if (mode === "insert") {
        const cols = Object.keys(rows![0]);
        const valueGroups = rows!.map((row) => {
          const placeholders = cols.map((c) => {
            params.push(toParam(row[c]));
            return `$${params.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        sql = `insert into ${table} (${cols.join(", ")}) values ${valueGroups.join(", ")}`;
        if (selectRequested) sql += ` returning ${selectCols}`;
      } else if (mode === "upsert") {
        const cols = Object.keys(rows![0]);
        const placeholders = cols.map((c) => {
          params.push(toParam(rows![0][c]));
          return `$${params.length}`;
        });
        const updateSet = cols
          .filter((c) => !onConflict!.split(",").map((s) => s.trim()).includes(c))
          .map((c) => `${c} = excluded.${c}`)
          .join(", ");
        sql = `insert into ${table} (${cols.join(", ")}) values (${placeholders.join(", ")})
               on conflict (${onConflict}) do update set ${updateSet}`;
      } else if (mode === "update") {
        const cols = Object.keys(updateObj!);
        const sets = cols.map((c) => {
          params.push(toParam(updateObj![c]));
          return `${c} = $${params.length}`;
        });
        sql = `update ${table} set ${sets.join(", ")}`;
        sql += whereClause(eqConds, params);
        if (selectRequested) sql += ` returning ${selectCols}`;
      } else {
        // select — special-case the one embedded-resource query in the codebase.
        if (table === "organization_members" && /organizations\s*\(\s*status\s*\)/.test(selectCols)) {
          sql = `select om.organization_id, om.role, o.status as organizations_status
                 from organization_members om left join organizations o on o.id = om.organization_id`;
          sql += whereClause(eqConds, params, "om");
          if (limitN != null) sql += ` limit ${limitN}`;
          const res = await query(sql, params);
          const shaped = res.rows.map((r) => ({
            organization_id: r.organization_id,
            role: r.role,
            organizations: r.organizations_status != null ? { status: r.organizations_status } : null,
          }));
          return finish(shaped);
        }
        sql = `select ${selectCols} from ${table}`;
        sql += whereClause(eqConds, params);
        if (limitN != null) sql += ` limit ${limitN}`;
      }

      const res = await query(sql, params);
      return finish(res.rows);
    } catch (err: any) {
      return { data: null, error: { message: err.message ?? String(err), ...err } };
    }
  }

  function finish(resultRows: any[]): { data: any; error: any } {
    if (singleMode === "maybeSingle") return { data: resultRows[0] ?? null, error: null };
    if (singleMode === "single") return { data: resultRows[0] ?? null, error: null };
    return { data: resultRows, error: null };
  }

  let selectRequested = false;

  const builder: any = {
    select(cols: string = "*") {
      selectRequested = true;
      if (mode === null) mode = "select";
      selectCols = cols;
      return builder;
    },
    insert(obj: Row | Row[]) {
      mode = "insert";
      rows = Array.isArray(obj) ? obj : [obj];
      return builder;
    },
    update(obj: Row) {
      mode = "update";
      updateObj = obj;
      return builder;
    },
    upsert(obj: Row, opts: { onConflict: string }) {
      mode = "upsert";
      rows = [obj];
      onConflict = opts.onConflict;
      return builder;
    },
    eq(col: string, val: unknown) {
      eqConds.push([col, val]);
      return builder;
    },
    limit(n: number) {
      limitN = n;
      return builder;
    },
    maybeSingle() {
      singleMode = "maybeSingle";
      return exec();
    },
    single() {
      singleMode = "single";
      return exec();
    },
    then(onResolve: any, onReject: any) {
      return exec().then(onResolve, onReject);
    },
  };
  return builder;
}

function whereClause(conds: [string, unknown][], params: unknown[], alias?: string): string {
  if (conds.length === 0) return "";
  const parts = conds.map(([col, val]) => {
    params.push(val);
    return `${alias ? `${alias}.` : ""}${col} = $${params.length}`;
  });
  return ` where ${parts.join(" and ")}`;
}

export const supabaseAdmin = {
  from: buildFrom,
};
