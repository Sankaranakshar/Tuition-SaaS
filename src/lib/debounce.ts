// Collapses a burst of calls arriving within `ms` of each other into a single
// trailing call, same trailing-edge behavior useRealtimeList.ts already uses
// inline for its own debounced refetch. Extracted here so the remaining
// legacy-page Realtime subscriptions (DEV_PLAN Tech Debt #4) can get the same
// "N events -> 1 reload" behavior without each duplicating the timer logic.
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  ms: number
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };
}
