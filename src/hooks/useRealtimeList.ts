import { useEffect, useState, useCallback, useId, useRef } from "react";
import { supabase } from "../supabase";
import { applyRealtimeChange, type RealtimeMergeConfig } from "./realtimeMerge";

// Shared per-entity Realtime list hook (originally duplicated in
// usePeople.ts and useMoney.ts; extracted here once a third workspace
// — Inbox, REDESIGN §6.5 — needed the same shape). Owns the query,
// bounding, Realtime subscription, and error state for one table. Every
// subscribed table must already be in the supabase_realtime publication
// (HANDOFF §16.2) or updates will silently no-op.
export function useRealtimeList<T>(
  channelPrefix: string,
  table: string,
  orgId: string | undefined | null,
  load: () => Promise<T[]>,
  filter?: string,
  // docs/OPTIMIZATION_AUDIT.md finding M10: without this, every single
  // Realtime event pays for a full refetch of up to (table-dependent) 500-1000
  // rows. When a caller supplies a merge config, a single-row INSERT/UPDATE/
  // DELETE payload is applied to `data` directly via realtimeMerge.ts's pure
  // reducer, and the debounced full refetch below only fires when the reducer
  // itself says it couldn't do that safely (see realtimeMerge.ts's own
  // comments for when that happens — a row leaving scope/bounds, or a
  // DELETE whose identity can't be recovered from a PK-only `old` row).
  merge?: RealtimeMergeConfig<T>
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The merge path (handleRealtimeEvent below) needs the list's current
  // value at the moment each Realtime event arrives, not whatever `data`
  // closed over when the long-lived subscription effect last ran.
  const dataRef = useRef(data);
  // Inbox is the first caller to mount the same hook (useNotificationsList)
  // twice at once — once in Layout.tsx's bell badge, once in Inbox.tsx's own
  // list — and supabase-js reuses a channel object by topic string, so a
  // second `.channel()` call with the same name returns the first mount's
  // already-`.subscribe()`d channel and its `.on()` call throws. useId() keeps
  // every mount's topic unique regardless of how many share the same table/org.
  const instanceId = useId();
  // Bounded consumers (e.g. Schedule's week-paged hooks) can fire more than
  // one refetch() in quick succession — the mount effect below plus an
  // explicit refetch on week change. Network responses aren't guaranteed to
  // resolve in request order, so without this guard a slower, stale request
  // (e.g. the previous week) can resolve after a newer one and silently
  // overwrite fresh data with stale results. Only the latest in-flight call
  // is allowed to commit its result.
  const requestSeq = useRef(0);

  // Always points at the caller's latest `load`, kept fresh every render
  // regardless of `refetch`'s own dependency array. See `refetch` below for
  // why this indirection exists.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // Same freshness concern as loadRef: the Realtime subscription effect binds
  // its callback once per [orgId, table], so it must read the caller's
  // latest merge config through a ref rather than closing over the value
  // from whichever render set up the subscription.
  const mergeRef = useRef(merge);
  useEffect(() => {
    mergeRef.current = merge;
  }, [merge]);

  // Stable identity (deps: [table], which is always a literal per call site
  // and never actually changes) so the Realtime subscription effect below —
  // whose callback is bound once when [orgId, table] last changed — keeps
  // calling the SAME `refetch`, which in turn always reads `loadRef.current`
  // at invocation time. Before this fix, `refetch` depended on `[load]`, so
  // a consumer whose `load` closes over changing state (e.g. Schedule's
  // week-paged views) had every Realtime-triggered refetch permanently call
  // the *mount-time* `load` — a session change while paged to a future week
  // would silently render the *original* week's data into the current view.
  // Explicit refetch() calls (e.g. on week navigation) were never affected,
  // since those call the hook's latest return value directly; only the
  // Realtime callback's own closure was stale.
  const refetch = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const rows = await loadRef.current();
      if (seq !== requestSeq.current) return; // superseded by a newer refetch
      dataRef.current = rows;
      setData(rows);
      setError(null);
    } catch (err: any) {
      if (seq !== requestSeq.current) return;
      setError(err?.message || `Could not load ${table}`);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [table]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refetch();
    })();

    // Realtime events on a busy table can arrive in a tight burst (e.g. a
    // batch of attendance marks touching several rows within milliseconds
    // of each other — the exact Monday-6pm scenario DEV_PLAN's k6 script
    // targets). Calling refetch() once per event means N events cost N full
    // re-queries of up to 500 rows each, for every connected client
    // (docs/OPTIMIZATION_AUDIT.md finding M10). Debouncing collapses any
    // burst arriving within DEBOUNCE_MS into a single trailing refetch.
    // This does NOT change the eventual result, only when it lands: a
    // change is reflected up to DEBOUNCE_MS later than before, which is
    // imperceptible for a background list refresh. The `refetch` returned
    // to callers (used for deliberate, single actions like week navigation)
    // is untouched by this and still fires immediately.
    const DEBOUNCE_MS = 200;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleDebouncedRefetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        refetch();
      }, DEBOUNCE_MS);
    };

    // With a merge config, most events resolve locally via realtimeMerge.ts's
    // pure reducer and skip the refetch entirely. When it reports it couldn't
    // merge safely (or no merge config was given at all), fall back to the
    // same debounced full refetch as before.
    const handleRealtimeEvent = (payload: any) => {
      const currentMerge = mergeRef.current;
      if (!currentMerge) {
        scheduleDebouncedRefetch();
        return;
      }
      const result = applyRealtimeChange(dataRef.current, payload, currentMerge);
      dataRef.current = result.data;
      setData(result.data);
      if (result.refetch) scheduleDebouncedRefetch();
    };

    const channel = supabase
      .channel(`${channelPrefix}-${table}-${orgId}-${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: filter ?? `organization_id=eq.${orgId}` },
        handleRealtimeEvent
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, table]);

  return { data, loading, error, refetch };
}
