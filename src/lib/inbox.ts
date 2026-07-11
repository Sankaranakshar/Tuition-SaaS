// Pure derivations for the Inbox workspace (DEV_PLAN §2a Stage 2 item 4,
// REDESIGN §6.5). No React, no Supabase — every function takes plain data
// plus an explicit `now`, matching the today.ts pattern so triage rules stay
// unit-testable and the clock stays injectable. The page (src/pages/Inbox.tsx)
// is the only place these get wired to live queries/Realtime.

import { daysOverdue, invoiceOutstandingPaise, type TodayInvoice } from "./today";
import { formatINR } from "./format";

export interface InboxMessage {
  id: string;
  conversationId: string;
  senderId: string;
  receiverId?: string | null;
  body: string;
  read: boolean;
  createdAt: string; // ISO
}

export type ConversationKind = "dm" | "class_channel";
export type AnchorType = "student" | "session" | "invoice" | "homework" | "class";

export interface InboxConversation {
  id: string;
  organizationId: string;
  participantIds: string[];
  kind: ConversationKind;
  anchorType?: AnchorType | null;
  anchorId?: string | null;
  createdAt: string;
}

export interface InboxTriageState {
  archivedAt?: string | null;
  snoozedUntil?: string | null;
}

export interface InboxNotification {
  id: string;
  type: string;
  payload: Record<string, any>;
  read: boolean;
  createdAt: string;
}

export interface InboxThreadItem {
  kind: "thread";
  conversation: InboxConversation;
  lastMessage: InboxMessage | null;
  unread: boolean;
  waitingForReply: boolean;
}

export interface InboxNotificationItem {
  kind: "notification";
  notification: InboxNotification;
}

export type InboxItem = InboxThreadItem | InboxNotificationItem;

function itemCreatedAt(item: InboxItem): string {
  return item.kind === "thread" ? item.lastMessage?.createdAt ?? item.conversation.createdAt : item.notification.createdAt;
}

function itemUnread(item: InboxItem): boolean {
  return item.kind === "thread" ? item.unread : !item.notification.read;
}

/** True if the thread's own last message is unread. `messages` narrower assumed pre-sorted or unsorted — sorted internally by createdAt. */
export function lastMessageOf(messages: InboxMessage[]): InboxMessage | null {
  if (messages.length === 0) return null;
  return [...messages].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

/**
 * True if the current viewer sent the last message and no one else in the
 * thread has replied since — REDESIGN §6.5's "waiting for reply" state, so a
 * tutor can see which parents never answered. Deliberately derived, not
 * stored: it can never go stale the way a persisted flag could.
 */
export function isWaitingForReply(messages: InboxMessage[], currentUserId: string): boolean {
  const last = lastMessageOf(messages);
  if (!last) return false;
  return last.senderId === currentUserId;
}

/** A message is unread for the current viewer if it's addressed to them (or, for a broadcast, not sent by them) and not yet marked read. */
export function isUnreadForViewer(message: InboxMessage, currentUserId: string): boolean {
  if (message.read) return false;
  if (message.receiverId) return message.receiverId === currentUserId;
  return message.senderId !== currentUserId; // class-channel broadcast: unread for everyone but the sender
}

export function isArchived(state: InboxTriageState | undefined): boolean {
  return !!state?.archivedAt;
}

export function isSnoozed(state: InboxTriageState | undefined, now: Date): boolean {
  if (!state?.snoozedUntil) return false;
  return new Date(state.snoozedUntil).getTime() > now.getTime();
}

export interface SortInboxItemsInput {
  conversations: InboxConversation[];
  messagesByConversation: Map<string, InboxMessage[]>;
  notifications: InboxNotification[];
  triageStateByConversation: Map<string, InboxTriageState>;
  currentUserId: string;
}

/**
 * Unread-first, then most-recent-first; archived threads and threads snoozed
 * into the future are hidden entirely (they resurface here on their own once
 * `now` passes `snoozedUntil` — no separate "wake up" job needed). Notifications
 * are interleaved as first-class items, not a separate list (REDESIGN §6.5:
 * "notifications become inbox items, not a dead-end list page").
 */
export function sortInboxItems(input: SortInboxItemsInput, now: Date): InboxItem[] {
  const { conversations, messagesByConversation, notifications, triageStateByConversation, currentUserId } = input;

  const threadItems: InboxThreadItem[] = conversations
    .filter((c) => {
      const state = triageStateByConversation.get(c.id);
      return !isArchived(state) && !isSnoozed(state, now);
    })
    .map((conversation) => {
      const messages = messagesByConversation.get(conversation.id) ?? [];
      const lastMessage = lastMessageOf(messages);
      return {
        kind: "thread" as const,
        conversation,
        lastMessage,
        unread: messages.some((m) => isUnreadForViewer(m, currentUserId)),
        waitingForReply: isWaitingForReply(messages, currentUserId),
      };
    });

  const notificationItems: InboxNotificationItem[] = notifications.map((notification) => ({
    kind: "notification" as const,
    notification,
  }));

  return [...threadItems, ...notificationItems].sort((a, b) => {
    const unreadDiff = Number(itemUnread(b)) - Number(itemUnread(a));
    if (unreadDiff !== 0) return unreadDiff;
    return new Date(itemCreatedAt(b)).getTime() - new Date(itemCreatedAt(a)).getTime();
  });
}

// ---- Anchor / context-card description (REDESIGN §6.5's anchor cards) -----

export interface AnchorContext {
  student?: { id: string; name: string } | null;
  session?: { id: string; startTime: string; status?: string } | null;
  invoice?: (TodayInvoice & { studentName?: string }) | null;
  homework?: { id: string; title: string; dueDate?: string | null; status?: string | null } | null;
  classTemplate?: { id: string; name: string } | null;
}

export interface AnchorDescription {
  title: string;
  detail?: string;
  tone: "default" | "warn" | "danger";
}

/** Formats an anchor's data into what `ContextCard` needs — the one place that turns "invoice #142, ₹3,000, overdue 6 days" into card copy. */
export function describeAnchor(anchorType: AnchorType | null | undefined, ctx: AnchorContext, now: Date): AnchorDescription {
  switch (anchorType) {
    case "student":
      return { title: ctx.student?.name ?? "Student", tone: "default" };
    case "session":
      return {
        title: "Session",
        detail: ctx.session ? new Date(ctx.session.startTime).toLocaleString() : undefined,
        tone: "default",
      };
    case "invoice": {
      if (!ctx.invoice) return { title: "Invoice", tone: "default" };
      const overdue = daysOverdue(ctx.invoice, now);
      const outstanding = invoiceOutstandingPaise(ctx.invoice);
      const parts = [formatINR(outstanding / 100)];
      if (overdue > 0) parts.push(`overdue ${overdue}d`);
      return {
        title: `Invoice${ctx.invoice.studentName ? ` · ${ctx.invoice.studentName}` : ""}`,
        detail: parts.join(" · "),
        tone: overdue > 0 ? "danger" : outstanding > 0 ? "warn" : "default",
      };
    }
    case "homework": {
      if (!ctx.homework) return { title: "Homework", tone: "default" };
      const due = ctx.homework.dueDate ? new Date(ctx.homework.dueDate) : null;
      const overdue = due ? due.getTime() < now.getTime() && ctx.homework.status === "pending" : false;
      return {
        title: ctx.homework.title,
        detail: due ? `Due ${due.toLocaleDateString()}${ctx.homework.status ? ` · ${ctx.homework.status}` : ""}` : ctx.homework.status ?? undefined,
        tone: overdue ? "warn" : "default",
      };
    }
    case "class":
      return { title: ctx.classTemplate?.name ?? "Class channel", tone: "default" };
    default:
      return { title: "Conversation", tone: "default" };
  }
}

// ---- Notification-as-inbox-item action mapping -----------------------------

export interface NotificationAction {
  label: string;
  kind: "record_payment" | "view_student" | "view_session" | "none";
}

/** Every notification must carry an inline action (REDESIGN §6.5: "anything you cannot act on from the notification is a design failure"). */
export function mapNotificationToAction(notification: InboxNotification): NotificationAction {
  switch (notification.type) {
    case "invoice_overdue":
    case "payment_due":
      return { label: "Record payment", kind: "record_payment" };
    case "session_reminder":
    case "session_conflict":
      return { label: "View session", kind: "view_session" };
    default:
      return { label: "View", kind: "view_student" };
  }
}
