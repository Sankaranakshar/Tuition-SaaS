import { useEffect, useState, useCallback, useId, useRef } from "react";
import { supabase } from "../supabase";

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
  filter?: string
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const refetch = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      const rows = await load();
      if (seq !== requestSeq.current) return; // superseded by a newer refetch
      setData(rows);
      setError(null);
    } catch (err: any) {
      if (seq !== requestSeq.current) return;
      setError(err?.message || `Could not load ${table}`);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refetch();
    })();

    const channel = supabase
      .channel(`${channelPrefix}-${table}-${orgId}-${instanceId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: filter ?? `organization_id=eq.${orgId}` },
        () => refetch()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, table]);

  return { data, loading, error, refetch };
}
