import { describe, it, expect } from "vitest";
import {
  minutesSinceMidnight,
  snapMinutes,
  pixelOffsetToTime,
  timeToPixelOffset,
  layoutOverlappingSessions,
  checkClientSideConflict,
  isOutsideAvailability,
  buildClassTemplatePayload,
  type ScheduleSession,
  type TutorAvailabilityWindow,
} from "../../src/lib/schedule";

describe("minutesSinceMidnight / snapMinutes", () => {
  it("computes minutes elapsed since local midnight", () => {
    expect(minutesSinceMidnight(new Date("2026-07-13T09:30:00"))).toBe(570);
    expect(minutesSinceMidnight(new Date("2026-07-13T00:00:00"))).toBe(0);
  });

  it("snaps to the nearest 15-minute increment by default", () => {
    expect(snapMinutes(7)).toBe(0);
    expect(snapMinutes(8)).toBe(15);
    expect(snapMinutes(22)).toBe(15);
    expect(snapMinutes(23)).toBe(30);
  });

  it("snaps to a custom step", () => {
    expect(snapMinutes(12, 30)).toBe(0);
    expect(snapMinutes(16, 30)).toBe(30);
  });
});

describe("pixelOffsetToTime / timeToPixelOffset", () => {
  it("round-trips a time through pixel offset and back, snapped", () => {
    const dayStart = new Date("2026-07-13T00:00:00");
    const pxPerMinute = 2;
    const time = pixelOffsetToTime(dayStart, 9 * 60 * pxPerMinute, pxPerMinute);
    expect(minutesSinceMidnight(time)).toBe(9 * 60);
  });

  it("converts a time-of-day to a pixel offset", () => {
    const t = new Date("2026-07-13T10:00:00");
    expect(timeToPixelOffset(t, 2)).toBe(1200);
  });
});

describe("layoutOverlappingSessions", () => {
  const s = (id: string, start: string, end: string): ScheduleSession => ({
    id,
    tutorId: "t1",
    startTime: start,
    endTime: end,
    status: "scheduled",
  });

  it("gives non-overlapping sessions the full single column", () => {
    const layout = layoutOverlappingSessions([
      s("a", "2026-07-13T09:00:00Z", "2026-07-13T10:00:00Z"),
      s("b", "2026-07-13T11:00:00Z", "2026-07-13T12:00:00Z"),
    ]);
    expect(layout.find((l) => l.id === "a")).toEqual({ id: "a", column: 0, columns: 1 });
    expect(layout.find((l) => l.id === "b")).toEqual({ id: "b", column: 0, columns: 1 });
  });

  it("splits two overlapping sessions into side-by-side columns", () => {
    const layout = layoutOverlappingSessions([
      s("a", "2026-07-13T09:00:00Z", "2026-07-13T10:00:00Z"),
      s("b", "2026-07-13T09:30:00Z", "2026-07-13T10:30:00Z"),
    ]);
    const a = layout.find((l) => l.id === "a")!;
    const b = layout.find((l) => l.id === "b")!;
    expect(a.columns).toBe(2);
    expect(b.columns).toBe(2);
    expect(a.column).not.toBe(b.column);
  });

  it("reuses a freed column once an earlier session in the cluster ends", () => {
    const layout = layoutOverlappingSessions([
      s("a", "2026-07-13T09:00:00Z", "2026-07-13T09:30:00Z"),
      s("b", "2026-07-13T09:15:00Z", "2026-07-13T10:00:00Z"),
      s("c", "2026-07-13T09:45:00Z", "2026-07-13T10:15:00Z"),
    ]);
    const a = layout.find((l) => l.id === "a")!;
    const c = layout.find((l) => l.id === "c")!;
    // a ends at 09:30, c starts at 09:45 — c can reuse a's column.
    expect(c.column).toBe(a.column);
  });
});

describe("checkClientSideConflict", () => {
  const existing: ScheduleSession[] = [
    { id: "s1", tutorId: "t1", startTime: "2026-07-13T09:00:00Z", endTime: "2026-07-13T10:00:00Z", status: "scheduled" },
  ];

  it("flags an overlapping candidate for the same tutor", () => {
    expect(
      checkClientSideConflict({ tutorId: "t1", startTime: "2026-07-13T09:30:00Z", endTime: "2026-07-13T10:30:00Z" }, existing)
    ).toBe(true);
  });

  it("ignores a non-overlapping candidate", () => {
    expect(
      checkClientSideConflict({ tutorId: "t1", startTime: "2026-07-13T10:00:00Z", endTime: "2026-07-13T11:00:00Z" }, existing)
    ).toBe(false);
  });

  it("ignores conflicts for a different tutor", () => {
    expect(
      checkClientSideConflict({ tutorId: "t2", startTime: "2026-07-13T09:30:00Z", endTime: "2026-07-13T10:30:00Z" }, existing)
    ).toBe(false);
  });

  it("excludes the session's own id (rescheduling in place)", () => {
    expect(
      checkClientSideConflict(
        { tutorId: "t1", startTime: "2026-07-13T09:15:00Z", endTime: "2026-07-13T10:15:00Z" },
        existing,
        "s1"
      )
    ).toBe(false);
  });

  it("ignores cancelled sessions", () => {
    const cancelled: ScheduleSession[] = [{ ...existing[0], status: "cancelled" }];
    expect(
      checkClientSideConflict({ tutorId: "t1", startTime: "2026-07-13T09:30:00Z", endTime: "2026-07-13T10:30:00Z" }, cancelled)
    ).toBe(false);
  });
});

describe("isOutsideAvailability", () => {
  const monday9to5: TutorAvailabilityWindow[] = [{ dayOfWeek: 1, startTime: "09:00", endTime: "17:00" }];

  it("treats a tutor with no declared availability as always available", () => {
    expect(isOutsideAvailability({ startTime: "2026-07-13T20:00:00", endTime: "2026-07-13T21:00:00" }, [])).toBe(false);
  });

  it("is not outside hours when fully inside a declared window", () => {
    // 2026-07-13 is a Monday.
    expect(
      isOutsideAvailability({ startTime: "2026-07-13T10:00:00", endTime: "2026-07-13T11:00:00" }, monday9to5)
    ).toBe(false);
  });

  it("is outside hours when the day has no declared window at all", () => {
    // 2026-07-12 is a Sunday, not covered by the Monday-only window.
    expect(
      isOutsideAvailability({ startTime: "2026-07-12T10:00:00", endTime: "2026-07-12T11:00:00" }, monday9to5)
    ).toBe(true);
  });

  it("is outside hours when the slot extends past the window end", () => {
    expect(
      isOutsideAvailability({ startTime: "2026-07-13T16:30:00", endTime: "2026-07-13T17:30:00" }, monday9to5)
    ).toBe(true);
  });
});

describe("buildClassTemplatePayload", () => {
  it("derives the template name from the course, defaulting capacity to 1 for ONE_ON_ONE", () => {
    const payload = buildClassTemplatePayload({
      organizationId: "org1",
      tutorId: "tutor1",
      courseId: "course1",
      courseName: "Algebra II",
      classType: "ONE_ON_ONE",
      pricingModel: "PER_SESSION",
      feeAmount: 500,
      capacity: 10,
      daysOfWeek: [],
      startHour: 9,
      startMinute: 0,
      durationMinutes: 60,
      isOnline: false,
      roomNumber: "Room 3",
      studentIds: ["stu1"],
    });
    expect(payload.name).toBe("Algebra II");
    expect(payload.capacity).toBe(1);
    expect(payload.organization_id).toBe("org1");
    expect(payload.room_number).toBe("Room 3");
  });

  it("falls back to the class type as the name when no course name is given", () => {
    const payload = buildClassTemplatePayload({
      organizationId: "org1",
      tutorId: "tutor1",
      courseId: "course1",
      courseName: null,
      classType: "BATCH",
      pricingModel: "MONTHLY",
      feeAmount: 2000,
      capacity: 8,
      daysOfWeek: [1, 3, 5],
      startHour: 16,
      startMinute: 30,
      durationMinutes: 90,
      isOnline: true,
      studentIds: [],
    });
    expect(payload.name).toBe("BATCH");
    expect(payload.capacity).toBe(8);
    expect(payload.room_number).toBeNull();
  });
});
