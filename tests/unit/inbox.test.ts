import { describe, it, expect } from "vitest";
import {
  sortInboxItems,
  isWaitingForReply,
  isUnreadForViewer,
  isSnoozed,
  describeAnchor,
  mapNotificationToAction,
  type InboxConversation,
  type InboxMessage,
  type InboxNotification,
  type InboxTriageState,
} from "../../src/lib/inbox";

const NOW = new Date("2026-07-11T12:00:00Z");
const ME = "user-tutor";
const PARENT = "user-parent";

function conversation(overrides: Partial<InboxConversation> = {}): InboxConversation {
  return {
    id: "c1",
    organizationId: "org1",
    participantIds: [ME, PARENT],
    kind: "dm",
    createdAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function message(overrides: Partial<InboxMessage> = {}): InboxMessage {
  return {
    id: "m1",
    conversationId: "c1",
    senderId: ME,
    receiverId: PARENT,
    body: "hi",
    read: false,
    createdAt: "2026-07-10T00:00:00Z",
    ...overrides,
  };
}

describe("isWaitingForReply", () => {
  it("is true when the viewer sent the last message and no one replied", () => {
    const messages = [message({ id: "m1", senderId: ME, createdAt: "2026-07-10T00:00:00Z" })];
    expect(isWaitingForReply(messages, ME)).toBe(true);
  });

  it("is false once the other participant replies", () => {
    const messages = [
      message({ id: "m1", senderId: ME, createdAt: "2026-07-09T00:00:00Z" }),
      message({ id: "m2", senderId: PARENT, receiverId: ME, createdAt: "2026-07-10T00:00:00Z" }),
    ];
    expect(isWaitingForReply(messages, ME)).toBe(false);
  });

  it("is false for an empty thread", () => {
    expect(isWaitingForReply([], ME)).toBe(false);
  });
});

describe("isUnreadForViewer", () => {
  it("is unread for the addressed receiver only", () => {
    const m = message({ receiverId: PARENT, read: false });
    expect(isUnreadForViewer(m, PARENT)).toBe(true);
    expect(isUnreadForViewer(m, ME)).toBe(false);
  });

  it("a read message is never unread", () => {
    expect(isUnreadForViewer(message({ receiverId: PARENT, read: true }), PARENT)).toBe(false);
  });

  it("a broadcast (no receiver) is unread for everyone but the sender", () => {
    const m = message({ senderId: ME, receiverId: null, read: false });
    expect(isUnreadForViewer(m, PARENT)).toBe(true);
    expect(isUnreadForViewer(m, ME)).toBe(false);
  });
});

describe("isSnoozed", () => {
  it("is snoozed while snoozedUntil is in the future", () => {
    const state: InboxTriageState = { snoozedUntil: "2026-07-12T00:00:00Z" };
    expect(isSnoozed(state, NOW)).toBe(true);
  });

  it("resurfaces once snoozedUntil has passed", () => {
    const state: InboxTriageState = { snoozedUntil: "2026-07-10T00:00:00Z" };
    expect(isSnoozed(state, NOW)).toBe(false);
  });

  it("is never snoozed with no state", () => {
    expect(isSnoozed(undefined, NOW)).toBe(false);
  });
});

describe("sortInboxItems", () => {
  it("sorts unread threads/notifications before read ones, then by recency", () => {
    const conversations = [
      conversation({ id: "read-old", createdAt: "2026-07-01T00:00:00Z" }),
      conversation({ id: "unread-old", createdAt: "2026-07-02T00:00:00Z" }),
      conversation({ id: "read-new", createdAt: "2026-07-09T00:00:00Z" }),
    ];
    const messagesByConversation = new Map<string, InboxMessage[]>([
      ["read-old", [message({ conversationId: "read-old", read: true, receiverId: PARENT, createdAt: "2026-07-01T00:00:00Z" })]],
      ["unread-old", [message({ conversationId: "unread-old", read: false, receiverId: ME, senderId: PARENT, createdAt: "2026-07-02T00:00:00Z" })]],
      ["read-new", [message({ conversationId: "read-new", read: true, receiverId: PARENT, createdAt: "2026-07-09T00:00:00Z" })]],
    ]);
    const items = sortInboxItems(
      { conversations, messagesByConversation, notifications: [], triageStateByConversation: new Map(), currentUserId: ME },
      NOW
    );
    expect(items.map((i) => (i.kind === "thread" ? i.conversation.id : i.notification.id))).toEqual([
      "unread-old",
      "read-new",
      "read-old",
    ]);
  });

  it("hides archived and future-snoozed threads", () => {
    const conversations = [
      conversation({ id: "archived" }),
      conversation({ id: "snoozed" }),
      conversation({ id: "visible" }),
    ];
    const messagesByConversation = new Map<string, InboxMessage[]>([
      ["archived", [message({ conversationId: "archived" })]],
      ["snoozed", [message({ conversationId: "snoozed" })]],
      ["visible", [message({ conversationId: "visible" })]],
    ]);
    const triageStateByConversation = new Map<string, InboxTriageState>([
      ["archived", { archivedAt: "2026-07-05T00:00:00Z" }],
      ["snoozed", { snoozedUntil: "2026-07-20T00:00:00Z" }],
    ]);
    const items = sortInboxItems(
      { conversations, messagesByConversation, notifications: [], triageStateByConversation, currentUserId: ME },
      NOW
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind === "thread" && items[0].conversation.id).toBe("visible");
  });

  it("interleaves notifications with threads by recency, not as a separate list", () => {
    const conversations = [conversation({ id: "c1", createdAt: "2026-07-01T00:00:00Z" })];
    const messagesByConversation = new Map<string, InboxMessage[]>([
      ["c1", [message({ conversationId: "c1", read: true, receiverId: PARENT, createdAt: "2026-07-01T00:00:00Z" })]],
    ]);
    const notifications: InboxNotification[] = [
      { id: "n1", type: "invoice_overdue", payload: {}, read: false, createdAt: "2026-07-11T00:00:00Z" },
    ];
    const items = sortInboxItems(
      { conversations, messagesByConversation, notifications, triageStateByConversation: new Map(), currentUserId: ME },
      NOW
    );
    expect(items[0].kind).toBe("notification");
  });
});

describe("describeAnchor", () => {
  it("describes a student anchor", () => {
    const result = describeAnchor("student", { student: { id: "s1", name: "Riya" } }, NOW);
    expect(result.title).toBe("Riya");
  });

  it("describes a session anchor with its start time", () => {
    const result = describeAnchor("session", { session: { id: "sess1", startTime: "2026-07-11T09:00:00Z" } }, NOW);
    expect(result.title).toBe("Session");
    expect(result.detail).toBeTruthy();
  });

  it("describes an overdue invoice anchor with tone=danger", () => {
    const result = describeAnchor(
      "invoice",
      {
        invoice: { id: "i1", studentName: "Riya", status: "unpaid", dueDate: "2026-07-01", totalPaise: 300000, paidPaise: 0 },
      },
      NOW
    );
    expect(result.title).toContain("Invoice");
    expect(result.title).toContain("Riya");
    expect(result.detail).toContain("overdue");
    expect(result.tone).toBe("danger");
  });

  it("describes a pending homework anchor with its due date", () => {
    const result = describeAnchor(
      "homework",
      { homework: { id: "hw1", title: "Algebra worksheet", dueDate: "2026-07-15", status: "pending" } },
      NOW
    );
    expect(result.title).toBe("Algebra worksheet");
    expect(result.detail).toContain("pending");
    expect(result.tone).toBe("default");
  });

  it("flags an overdue-pending homework anchor with tone=warn", () => {
    const result = describeAnchor(
      "homework",
      { homework: { id: "hw1", title: "Algebra worksheet", dueDate: "2026-07-01", status: "pending" } },
      NOW
    );
    expect(result.tone).toBe("warn");
  });
});

describe("mapNotificationToAction", () => {
  it("maps invoice_overdue to a record-payment action", () => {
    const n: InboxNotification = { id: "n1", type: "invoice_overdue", payload: {}, read: false, createdAt: "2026-07-11T00:00:00Z" };
    expect(mapNotificationToAction(n).kind).toBe("record_payment");
  });

  it("falls back to a view action for unknown types", () => {
    const n: InboxNotification = { id: "n1", type: "something_new", payload: {}, read: false, createdAt: "2026-07-11T00:00:00Z" };
    expect(mapNotificationToAction(n).kind).toBe("view_student");
  });
});
