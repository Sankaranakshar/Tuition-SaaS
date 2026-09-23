import { describe, it, expect } from "vitest";
import { TEMPLATES, renderTemplate } from "../../server/utils/messaging/templates.ts";
import { backoffMinutes, nextChannel, isDeadLetter, MAX_DELIVERY_ATTEMPTS } from "../../server/utils/messaging/backoff.ts";
import {
  invoiceRaisedKey, paymentReceivedKey, feeDueReminderKey,
  inviteLinkKey, sessionReminderKey, absenceAlertKey,
} from "../../server/utils/messaging/idempotency.ts";

describe("messaging template rendering (B-17)", () => {
  it("renders invoice_raised with the rupee amount and due date", () => {
    const text = renderTemplate("invoice_raised", {
      studentName: "Aarav", amountPaise: 150000, dueDate: "2026-10-01", portalUrl: "https://app.example/app",
    });
    expect(text).toContain("₹1,500");
    expect(text).toContain("Aarav");
    expect(text).toContain("2026-10-01");
    expect(text).toContain("https://app.example/app");
  });

  it("renders invoice_raised without a due date when none is set", () => {
    const text = renderTemplate("invoice_raised", {
      studentName: "Aarav", amountPaise: 100000, dueDate: null, portalUrl: "https://app.example/app",
    });
    expect(text).not.toContain("on null");
    expect(text).toContain("₹1,000");
  });

  it("renders fee_due_reminder with the outstanding amount", () => {
    const text = renderTemplate("fee_due_reminder", {
      studentName: "Diya", outstandingPaise: 250000, portalUrl: "https://app.example/app",
    });
    expect(text).toContain("₹2,500");
    expect(text).toContain("Diya");
  });

  it("renders payment_received as a thank-you with the amount", () => {
    const text = renderTemplate("payment_received", {
      studentName: "Diya", amountPaise: 250000, portalUrl: "https://app.example/app",
    });
    expect(text).toContain("₹2,500");
    expect(text.toLowerCase()).toContain("thank you");
  });

  it("renders invite_link differently for a parent vs a student", () => {
    const parentText = renderTemplate("invite_link", {
      studentName: "Kabir", inviteUrl: "https://app.example/onboarding?invite=tok", role: "parent",
    });
    const studentText = renderTemplate("invite_link", {
      studentName: "Kabir", inviteUrl: "https://app.example/onboarding?invite=tok", role: "student",
    });
    expect(parentText).toContain("follow Kabir's tuition");
    expect(studentText).toContain("as Kabir");
    expect(parentText).not.toBe(studentText);
  });

  it("renders session_reminder with an optional subject", () => {
    const withSubject = renderTemplate("session_reminder", {
      studentName: "Ira", startTimeLocal: "Mon, 6:30 pm", subject: "Algebra II",
    });
    const withoutSubject = renderTemplate("session_reminder", {
      studentName: "Ira", startTimeLocal: "Mon, 6:30 pm", subject: null,
    });
    expect(withSubject).toContain("Algebra II");
    expect(withoutSubject).not.toContain("null");
    expect(withoutSubject).toContain("Ira");
  });

  it("renders absence_alert with the student name and date", () => {
    const text = renderTemplate("absence_alert", { studentName: "Ira", sessionDateLocal: "2026-09-23" });
    expect(text).toContain("Ira");
    expect(text).toContain("absent");
    expect(text).toContain("2026-09-23");
  });

  it("throws on an unknown template key rather than rendering silently", () => {
    expect(() => renderTemplate("not_a_real_template" as any, {})).toThrow();
  });

  it("every registered template is transactional (no marketing category exists yet to leak into)", () => {
    for (const def of Object.values(TEMPLATES)) {
      expect(def.category).toBe("transactional");
    }
  });
});

describe("delivery-sweep backoff/retry state machine (B-17)", () => {
  it("grows exponentially and caps at 60 minutes", () => {
    expect(backoffMinutes(1)).toBe(2);
    expect(backoffMinutes(2)).toBe(4);
    expect(backoffMinutes(3)).toBe(8);
    expect(backoffMinutes(10)).toBe(60);
  });

  it("flips whatsapp to sms on the first failure, then holds", () => {
    expect(nextChannel(1, "whatsapp")).toBe("sms");
    expect(nextChannel(2, "sms")).toBe("sms");
    expect(nextChannel(2, "whatsapp")).toBe("whatsapp");
  });

  it("never flips an already-sms message back to whatsapp", () => {
    expect(nextChannel(1, "sms")).toBe("sms");
  });

  it("dead-letters only once attempts reach the max", () => {
    expect(isDeadLetter(MAX_DELIVERY_ATTEMPTS - 1)).toBe(false);
    expect(isDeadLetter(MAX_DELIVERY_ATTEMPTS)).toBe(true);
    expect(isDeadLetter(MAX_DELIVERY_ATTEMPTS + 1)).toBe(true);
  });
});

describe("idempotency key derivation (B-17)", () => {
  it("is stable for the same logical event", () => {
    expect(invoiceRaisedKey("inv-1")).toBe(invoiceRaisedKey("inv-1"));
    expect(paymentReceivedKey("rzp", "pay-1")).toBe(paymentReceivedKey("rzp", "pay-1"));
  });

  it("is distinct across genuinely different events", () => {
    expect(invoiceRaisedKey("inv-1")).not.toBe(invoiceRaisedKey("inv-2"));
    expect(paymentReceivedKey("rzp", "pay-1")).not.toBe(paymentReceivedKey("manual", "pay-1"));
  });

  it("buckets fee_due_reminder by day, so today and tomorrow differ but two calls today match", () => {
    const today = feeDueReminderKey("inv-1", "2026-09-23");
    const todayAgain = feeDueReminderKey("inv-1", "2026-09-23");
    const tomorrow = feeDueReminderKey("inv-1", "2026-09-24");
    expect(today).toBe(todayAgain);
    expect(today).not.toBe(tomorrow);
  });

  it("namespaces invite links by role so a parent and student invite for the same token never collide", () => {
    expect(inviteLinkKey("parent", "tok")).not.toBe(inviteLinkKey("student", "tok"));
  });

  it("session_reminder and absence_alert key on both session and student", () => {
    expect(sessionReminderKey("sess-1", "stu-1")).not.toBe(sessionReminderKey("sess-1", "stu-2"));
    expect(sessionReminderKey("sess-1", "stu-1")).not.toBe(sessionReminderKey("sess-2", "stu-1"));
    expect(absenceAlertKey("sess-1", "stu-1")).not.toBe(sessionReminderKey("sess-1", "stu-1"));
  });
});
