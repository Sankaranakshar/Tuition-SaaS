import { describe, it, expect, vi } from "vitest";
import { debounce } from "../../src/lib/debounce";

describe("debounce", () => {
  it("collapses a burst of calls into one trailing call", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("passes through the latest call's arguments", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced("first");
    debounced("second");
    vi.advanceTimersByTime(200);

    expect(fn).toHaveBeenCalledWith("second");
    vi.useRealTimers();
  });

  it("fires again after the delay elapses between calls", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 200);

    debounced();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);

    debounced();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
