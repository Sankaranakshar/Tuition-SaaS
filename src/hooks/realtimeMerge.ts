// Pure reducer behind useRealtimeList's per-row merge (docs/OPTIMIZATION_AUDIT.md
// finding M10). No React, no Supabase — takes the current list plus one
// postgres_changes payload and returns the next list, so it's unit-testable
// without mounting a hook. src/hooks/useRealtimeList.ts is the only caller.
//
// Replica identity caveat: none of this app's tables have REPLICA IDENTITY
// FULL set (supabase/migrations/20260710120000_realtime_publication.sql and
// friends only add tables to the publication, they don't touch replica
// identity). Postgres's default replica identity means a DELETE's `old` row
// carries ONLY the primary key column(s) — not the rest of the row. `new` on
// INSERT/UPDATE is always the complete row regardless of replica identity.
// That's why `getDeleteKey` is a separate, optional extractor from `getId`:
// for a table whose primary key is the same field a hook keys its list by
// (the common case — `id`), the two agree and every DELETE can be merged
// locally. For a table keyed by something else in T's shape (e.g. wallets'
// list is keyed by `student_id`, but the table's primary key is `id`), the
// DELETE payload doesn't carry that key at all, and there is no honest way to
// merge it — `getDeleteKey` should return undefined so the caller falls back
// to a full refetch instead of guessing.

export type RealtimeEventType = "INSERT" | "UPDATE" | "DELETE";

export interface RealtimeChangePayload<Raw> {
  eventType: RealtimeEventType;
  new: Raw;
  old: Raw;
}

export interface RealtimeMergeConfig<T, Raw = any> {
  /** Turns one raw postgres row (snake_case, as sent by Realtime) into the shape T's list holds. */
  mapRow: (raw: Raw) => T;
  /** The identity field merged rows are matched on. Usually `(row) => row.id`. */
  getId: (row: T) => string;
  /**
   * Extracts the same identity from a DELETE's `old` row. Defaults to
   * `(old) => old?.id`, which is correct whenever the table's primary key IS
   * the field `getId` uses. Return undefined for any row where the identity
   * can't be recovered from a PK-only `old` payload — that forces a refetch
   * instead of a wrong or skipped removal.
   */
  getDeleteKey?: (old: Raw) => string | undefined;
  /**
   * Mirrors the WHERE-clause conditions `load()` applies that Realtime's own
   * postgres_changes filter can't express (role/tenant scoping, a visible
   * date range, a soft-delete flag, ...). Defaults to always-true. Operates
   * on the raw row so it can check columns that never make it into T.
   */
  belongsToView?: (raw: Raw) => boolean;
  /** Optional sort comparator used to place an INSERTed row at the right index instead of appending it. */
  compare?: (a: T, b: T) => number;
}

export interface RealtimeMergeResult<T> {
  data: T[];
  /** true when the payload couldn't be safely merged and a full refetch is still needed. */
  refetch: boolean;
}

export function applyRealtimeChange<T, Raw = any>(
  current: T[],
  payload: RealtimeChangePayload<Raw>,
  config: RealtimeMergeConfig<T, Raw>
): RealtimeMergeResult<T> {
  const { mapRow, getId, belongsToView, compare } = config;
  const getDeleteKey = config.getDeleteKey ?? ((old: any) => old?.id);

  if (payload.eventType === "DELETE") {
    const key = getDeleteKey(payload.old);
    if (key == null) return { data: current, refetch: true };
    const filtered = current.filter((row) => getId(row) !== key);
    return { data: filtered, refetch: false };
  }

  const raw = payload.new;
  const inView = belongsToView ? belongsToView(raw) : true;
  const mapped = mapRow(raw);
  const id = getId(mapped);
  const idx = current.findIndex((row) => getId(row) === id);

  if (!inView) {
    // Irrelevant to this view (e.g. another tutor's student) and never was
    // — nothing to do, and no reason to pay for a refetch either.
    if (idx === -1) return { data: current, refetch: false };
    // Was visible, just left scope/bounds (reassigned, soft-deleted, dragged
    // out of the visible week...). Drop it now; a refetch may surface a
    // replacement row we have no local way to know about.
    return { data: current.filter((row) => getId(row) !== id), refetch: true };
  }

  if (idx === -1) {
    if (payload.eventType === "UPDATE") {
      // Entered view/scope on an UPDATE we weren't tracking — e.g. a session
      // reassigned to this tutor. Correct position and completeness aren't
      // knowable from one row, so refetch rather than guess.
      return { data: current, refetch: true };
    }
    if (!compare) return { data: [...current, mapped], refetch: false };
    const next = current.slice();
    const insertAt = next.findIndex((row) => compare(mapped, row) < 0);
    if (insertAt === -1) next.push(mapped);
    else next.splice(insertAt, 0, mapped);
    return { data: next, refetch: false };
  }

  const next = current.slice();
  next[idx] = mapped;
  return { data: next, refetch: false };
}
