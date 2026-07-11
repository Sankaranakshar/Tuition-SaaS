import { useEffect, useMemo, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Send, Archive, Clock, Radio, MessageSquare, Inbox as InboxIcon, Plus, X } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { EmptyState, SkeletonRow, ContextCard, Popover } from "../components/kit";
import { formatTime, formatDate } from "../lib/format";
import { recordManualPayment } from "../lib/api";
import {
  sortInboxItems,
  describeAnchor,
  mapNotificationToAction,
  type InboxItem,
  type InboxMessage,
  type InboxConversation,
} from "../lib/inbox";
import {
  useConversationsList,
  useMessagesForConversation,
  useNotificationsList,
  useInboxStateMap,
  useAnchorContext,
  useMessageableContacts,
  sendMessage,
  archiveConversation,
  unarchiveConversation,
  snoozeConversation,
  markNotificationRead,
  ensureClassChannel,
  findOrCreateDirectConversation,
} from "../hooks/useInbox";

type Segment = "all" | "unread" | "waiting" | "archived";
const SEGMENTS: { key: Segment; labelKey: string }[] = [
  { key: "all", labelKey: "inbox.segAll" },
  { key: "unread", labelKey: "inbox.segUnread" },
  { key: "waiting", labelKey: "inbox.segWaiting" },
  { key: "archived", labelKey: "inbox.segArchived" },
];

const SNOOZE_OPTIONS = [
  { labelKey: "inbox.snoozeHour", hours: 1 },
  { labelKey: "inbox.snoozeTomorrow", hours: 18 },
  { labelKey: "inbox.snoozeWeek", hours: 24 * 7 },
];

// Inbox workspace (DEV_PLAN §2a Stage 2 item 4, REDESIGN §6.5). Replaces
// Messaging.tsx + Notifications.tsx: contextual threads with anchor cards,
// class broadcast channels, notifications rendered as actionable items
// in the same list, and triage (unread-first, archive on `E`, snooze).
export default function Inbox() {
  const { t } = useTranslation();
  const { user, currentRole } = useAuth();
  const orgId = user?.organizationId;
  const isStaff = !["student", "parent"].includes(currentRole || "");
  const [searchParams, setSearchParams] = useSearchParams();
  const segment: Segment = (searchParams.get("segment") as Segment) || "all";
  const setSegment = (s: Segment) => setSearchParams((prev) => { prev.set("segment", s); return prev; }, { replace: true });

  const { data: conversations, loading: conversationsLoading } = useConversationsList();
  const { data: notifications } = useNotificationsList();
  const { map: triageMap } = useInboxStateMap();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newMessageOpen, setNewMessageOpen] = useState(false);

  // messagesByConversation is only populated for conversations we've already
  // loaded a preview for. For the sort/unread computation we need last-message
  // data for every visible conversation, so we fetch previews for the whole
  // list once conversations arrive (bounded — same 300-row cap as the list query).
  const [messagesByConversation, setMessagesByConversation] = useState<Map<string, InboxMessage[]>>(new Map());
  useEffect(() => {
    if (conversations.length === 0) return;
    let cancelled = false;
    (async () => {
      const ids = conversations.map((c) => c.id);
      const { data, error } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, receiver_id, body, read, created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: true })
        .limit(2000);
      if (cancelled || error) return;
      const next = new Map<string, InboxMessage[]>();
      for (const row of data || []) {
        const msg: InboxMessage = {
          id: row.id,
          conversationId: row.conversation_id,
          senderId: row.sender_id,
          receiverId: row.receiver_id,
          body: row.body,
          read: row.read,
          createdAt: row.created_at,
        };
        const list = next.get(msg.conversationId) ?? [];
        list.push(msg);
        next.set(msg.conversationId, list);
      }
      if (!cancelled) setMessagesByConversation(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [conversations]);

  const now = new Date();
  const sortedItems = useMemo(
    () =>
      user
        ? sortInboxItems(
            { conversations, messagesByConversation, notifications, triageStateByConversation: triageMap, currentUserId: user.id },
            now
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conversations, messagesByConversation, notifications, triageMap, user]
  );

  const visibleItems = useMemo(() => {
    switch (segment) {
      case "unread":
        return sortedItems.filter((i) => (i.kind === "thread" ? i.unread : !i.notification.read));
      case "waiting":
        return sortedItems.filter((i) => i.kind === "thread" && i.waitingForReply);
      case "archived":
        return conversations
          .filter((c) => triageMap.get(c.id)?.archivedAt)
          .map((conversation) => ({
            kind: "thread" as const,
            conversation,
            lastMessage: messagesByConversation.get(conversation.id)?.slice(-1)[0] ?? null,
            unread: false,
            waitingForReply: false,
          }));
      default:
        return sortedItems;
    }
  }, [segment, sortedItems, conversations, triageMap, messagesByConversation]);

  // Open-or-create a DM from a People deep link. `?participant=<userId>`
  // (parent row) resolves straight to a thread; `?student=<id>` alone (a
  // student row, where we don't know which of the student/parent contacts
  // the staffer means) opens the New message picker instead of guessing.
  useEffect(() => {
    if (!orgId || !user) return;
    const participant = searchParams.get("participant");
    const student = searchParams.get("student");
    if (participant) {
      (async () => {
        const conversationId = await findOrCreateDirectConversation({
          organizationId: orgId,
          participantIds: [user.id, participant].sort() as [string, string],
          anchorType: student ? "student" : undefined,
          anchorId: student ?? undefined,
        });
        setSelectedId(conversationId);
        setSearchParams((prev) => { prev.delete("participant"); prev.delete("student"); return prev; }, { replace: true });
      })();
    } else if (student) {
      setNewMessageOpen(true);
      setSearchParams((prev) => { prev.delete("student"); return prev; }, { replace: true });
    }
  }, [searchParams, orgId, user, setSearchParams]);

  const selectedThread = useMemo(
    () => (selectedId ? conversations.find((c) => c.id === selectedId) ?? null : null),
    [selectedId, conversations]
  );

  // `E` archives the open thread — REDESIGN §6.5 triage. Optimistic write,
  // undo reverts it (REDESIGN §2: undo, never confirm).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (e.key.toLowerCase() !== "e" || !selectedId || !user) return;
      const id = selectedId;
      archiveConversation(id, user.id)
        .then(() => {
          setSelectedId(null);
          toast.success(t("inbox.archived"), {
            action: { label: t("common.undo"), onClick: () => unarchiveConversation(id, user.id) },
          });
        })
        .catch((err: any) => toast.error(err?.message || t("inbox.archiveFailed")));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, user, t]);

  if (!orgId || !user) return null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between px-1 pb-3">
        <h1 className="text-2xl font-bold text-[var(--cs-text)]">{t("nav.inbox")}</h1>
        <button
          onClick={() => setNewMessageOpen(true)}
          className="flex items-center gap-1.5 rounded-[6px] bg-[var(--cs-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> {t("inbox.newMessage")}
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--cs-border)] px-1">
        {SEGMENTS.map(({ key, labelKey }) => (
          <button
            key={key}
            onClick={() => setSegment(key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              segment === key
                ? "border-[var(--cs-accent)] text-[var(--cs-accent)]"
                : "border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text)]"
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-80 shrink-0 overflow-y-auto border-r border-[var(--cs-border)]">
          {conversationsLoading ? (
            <div className="divide-y divide-[var(--cs-border)]">{Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}</div>
          ) : visibleItems.length === 0 ? (
            <EmptyState icon={InboxIcon} title={t("inbox.empty")} description={t("inbox.emptyHint")} />
          ) : (
            <div className="divide-y divide-[var(--cs-border)]">
              {visibleItems.map((item) =>
                item.kind === "thread" ? (
                  <ThreadRow
                    key={item.conversation.id}
                    item={item}
                    active={item.conversation.id === selectedId}
                    currentUserId={user.id}
                    onClick={() => setSelectedId(item.conversation.id)}
                  />
                ) : (
                  <NotificationRow key={item.notification.id} item={item} />
                )
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-hidden">
          {selectedThread ? (
            <ThreadView thread={selectedThread} currentUserId={user.id} />
          ) : (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon={MessageSquare} title={t("inbox.selectThread")} />
            </div>
          )}
        </div>
      </div>

      {newMessageOpen && (
        <NewMessageDialog
          orgId={orgId}
          currentUserId={user.id}
          isStaff={isStaff}
          onClose={() => setNewMessageOpen(false)}
          onCreated={(id) => {
            setSelectedId(id);
            setNewMessageOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ThreadRow({
  item,
  active,
  currentUserId,
  onClick,
}: {
  item: Extract<InboxItem, { kind: "thread" }>;
  active: boolean;
  currentUserId: string;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const { conversation, lastMessage, unread, waitingForReply } = item;
  const otherName = conversation.kind === "class_channel" ? t("inbox.classChannel") : t("inbox.directMessage");
  return (
    <button
      onClick={onClick}
      className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors ${
        active ? "bg-[var(--cs-accent-soft)]" : "hover:bg-[var(--cs-bg)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1.5 truncate text-sm ${unread ? "font-semibold text-[var(--cs-text)]" : "text-[var(--cs-text)]"}`}>
          {conversation.kind === "class_channel" && <Radio className="h-3.5 w-3.5 shrink-0 text-[var(--cs-text-muted)]" />}
          {otherName}
        </span>
        {lastMessage && <span className="shrink-0 text-[11px] text-[var(--cs-text-muted)]">{formatDate(lastMessage.createdAt)}</span>}
      </div>
      <div className="flex items-center gap-1.5">
        {lastMessage && <span className="truncate text-xs text-[var(--cs-text-muted)]">{lastMessage.body}</span>}
        {waitingForReply && (
          <span className="shrink-0 rounded-full bg-[var(--cs-warn-soft,var(--cs-bg))] px-1.5 py-0.5 text-[10px] font-medium text-[var(--cs-warn)]">
            {t("inbox.waiting")}
          </span>
        )}
        {unread && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--cs-accent)]" />}
      </div>
    </button>
  );
}

function NotificationRow({ item }: { item: Extract<InboxItem, { kind: "notification" }> }) {
  const { t } = useTranslation();
  const { notification } = item;
  const action = mapNotificationToAction(notification);

  const act = async () => {
    await markNotificationRead(notification.id);
    if (action.kind === "record_payment" && notification.payload.invoiceId) {
      window.location.assign(`/app/money?invoice=${notification.payload.invoiceId}`);
    } else if (notification.payload.studentId) {
      window.location.assign(`/app/students/${notification.payload.studentId}`);
    }
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2.5 ${!notification.read ? "bg-[var(--cs-accent-soft)]" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm ${!notification.read ? "font-semibold text-[var(--cs-text)]" : "text-[var(--cs-text)]"}`}>
          {notification.payload.title || t(`inbox.notificationType.${notification.type}`, { defaultValue: notification.type })}
        </div>
        <div className="truncate text-xs text-[var(--cs-text-muted)]">{formatDate(notification.createdAt)}</div>
      </div>
      {action.kind !== "none" && (
        <button onClick={act} className="shrink-0 rounded-[6px] border border-[var(--cs-border)] px-2 py-1 text-xs font-medium hover:bg-[var(--cs-bg)]">
          {action.label}
        </button>
      )}
    </div>
  );
}

function ThreadView({ thread, currentUserId }: { thread: InboxConversation; currentUserId: string }) {
  const { t } = useTranslation();
  const { data: messages } = useMessagesForConversation(thread.id);
  const { context } = useAnchorContext(thread.anchorType, thread.anchorId);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const now = new Date();
  const anchorDescription = thread.anchorType ? describeAnchor(thread.anchorType, context, now) : null;
  const otherParticipant = thread.participantIds.find((id: string) => id !== currentUserId) ?? null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      await sendMessage({
        organizationId: thread.organizationId,
        conversationId: thread.id,
        senderId: currentUserId,
        receiverId: thread.kind === "dm" ? otherParticipant : null,
        body: body.trim(),
      });
      setBody("");
    } catch (err: any) {
      toast.error(err?.message || t("inbox.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--cs-border)] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-[var(--cs-text)]">
            {thread.kind === "class_channel" ? t("inbox.classChannel") : t("inbox.directMessage")}
          </span>
          <div className="flex items-center gap-1">
            <SnoozeButton conversationId={thread.id} currentUserId={currentUserId} />
            <ArchiveButton conversationId={thread.id} currentUserId={currentUserId} />
          </div>
        </div>
        {anchorDescription && (
          <div className="mt-2">
            <AnchorAction anchorType={thread.anchorType} description={anchorDescription} context={context} />
          </div>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.senderId === currentUserId ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[70%] rounded-[10px] px-3 py-2 text-sm ${
                m.senderId === currentUserId ? "bg-[var(--cs-accent)] text-white" : "bg-[var(--cs-surface)] text-[var(--cs-text)]"
              }`}
            >
              <div>{m.body}</div>
              <div className={`mt-0.5 text-[10px] ${m.senderId === currentUserId ? "text-white/70" : "text-[var(--cs-text-muted)]"}`}>
                {formatTime(m.createdAt)}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="flex items-center gap-2 border-t border-[var(--cs-border)] p-3">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("inbox.messagePlaceholder")}
          className="flex-1 rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--cs-accent)]"
        />
        <button
          type="submit"
          disabled={sending || !body.trim()}
          className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-[var(--cs-accent)] text-white disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function AnchorAction({
  anchorType,
  description,
  context,
}: {
  anchorType: string | null | undefined;
  description: { title: string; detail?: string; tone: "default" | "warn" | "danger" };
  context: ReturnType<typeof useAnchorContext>["context"];
}) {
  if (anchorType === "invoice" && context.invoice && context.invoice.status !== "paid" && context.invoice.status !== "void") {
    return (
      <ContextCard
        title={description.title}
        detail={description.detail}
        tone={description.tone}
        action={<RecordPaymentAction invoiceId={context.invoice.id} outstandingPaise={(context.invoice.totalPaise ?? 0) - (context.invoice.paidPaise ?? 0)} />}
      />
    );
  }
  return <ContextCard title={description.title} detail={description.detail} tone={description.tone} />;
}

function RecordPaymentAction({ invoiceId, outstandingPaise }: { invoiceId: string; outstandingPaise: number }) {
  const { t } = useTranslation();
  return (
    <Popover
      align="right"
      trigger={
        <span className="cursor-pointer rounded-[6px] border border-[var(--cs-border)] px-2 py-1 text-xs font-medium hover:bg-[var(--cs-bg)]">
          {t("inbox.recordPayment")}
        </span>
      }
    >
      {(close) => <RecordPaymentForm invoiceId={invoiceId} outstandingPaise={outstandingPaise} onDone={close} />}
    </Popover>
  );
}

function RecordPaymentForm({ invoiceId, outstandingPaise, onDone }: { invoiceId: string; outstandingPaise: number; onDone: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState((outstandingPaise / 100).toFixed(2));
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountPaise = Math.round(parseFloat(amount) * 100);
    if (!amountPaise || amountPaise <= 0) return;
    setSaving(true);
    try {
      await recordManualPayment({ invoiceId, amountPaise, method: "cash" });
      toast.success(t("money.paymentRecorded"));
      onDone();
    } catch (err: any) {
      toast.error(err?.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex w-48 flex-col gap-2">
      <label className="text-xs font-medium text-[var(--cs-text-muted)]">{t("money.amount")}</label>
      <input
        autoFocus
        type="number"
        min="0"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--cs-accent)]"
      />
      <button
        type="submit"
        disabled={saving}
        className="rounded-[6px] bg-[var(--cs-accent)] px-2.5 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("money.recordPayment")}
      </button>
    </form>
  );
}

function ArchiveButton({ conversationId, currentUserId }: { conversationId: string; currentUserId: string }) {
  const { t } = useTranslation();
  const onArchive = () => {
    archiveConversation(conversationId, currentUserId)
      .then(() =>
        toast.success(t("inbox.archived"), {
          action: { label: t("common.undo"), onClick: () => unarchiveConversation(conversationId, currentUserId) },
        })
      )
      .catch((err: any) => toast.error(err?.message || t("inbox.archiveFailed")));
  };
  return (
    <button onClick={onArchive} title={t("inbox.archive")} className="rounded-[6px] p-1.5 text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)] hover:text-[var(--cs-text)]">
      <Archive className="h-4 w-4" />
    </button>
  );
}

function SnoozeButton({ conversationId, currentUserId }: { conversationId: string; currentUserId: string }) {
  const { t } = useTranslation();
  return (
    <Popover
      align="right"
      trigger={
        <span title={t("inbox.snooze")} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[6px] text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)] hover:text-[var(--cs-text)]">
          <Clock className="h-4 w-4" />
        </span>
      }
    >
      {(close) => (
        <div className="flex w-40 flex-col gap-1">
          {SNOOZE_OPTIONS.map((opt) => (
            <button
              key={opt.hours}
              onClick={() => {
                const until = new Date(Date.now() + opt.hours * 3600 * 1000);
                snoozeConversation(conversationId, currentUserId, until)
                  .then(() => toast.success(t("inbox.snoozed")))
                  .catch((err: any) => toast.error(err?.message));
                close();
              }}
              className="rounded-[6px] px-2 py-1.5 text-left text-sm hover:bg-[var(--cs-bg)]"
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

function NewMessageDialog({
  orgId,
  currentUserId,
  isStaff,
  onClose,
  onCreated,
}: {
  orgId: string;
  currentUserId: string;
  isStaff: boolean;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const { t } = useTranslation();
  const { contacts, loading } = useMessageableContacts();
  const [classTemplates, setClassTemplates] = useState<{ id: string; name: string }[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isStaff) return;
    supabase
      .from("class_templates")
      .select("id, name")
      .eq("organization_id", orgId)
      .limit(100)
      .then(({ data }) => setClassTemplates(data || []));
  }, [orgId, isStaff]);

  const startDm = async (userId: string, studentId?: string) => {
    setCreating(true);
    try {
      const conversationId = await findOrCreateDirectConversation({
        organizationId: orgId,
        participantIds: [currentUserId, userId].sort() as [string, string],
        anchorType: studentId ? "student" : undefined,
        anchorId: studentId,
      });
      onCreated(conversationId);
    } catch (err: any) {
      toast.error(err?.message || t("inbox.sendFailed"));
    } finally {
      setCreating(false);
    }
  };

  const openChannel = async (templateId: string) => {
    setCreating(true);
    try {
      const { conversationId } = await ensureClassChannel(templateId);
      onCreated(conversationId);
    } catch (err: any) {
      toast.error(err?.message || t("inbox.sendFailed"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[70vh] w-full max-w-md flex-col rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--cs-text)]">{t("inbox.newMessage")}</h2>
          <button onClick={onClose} className="text-[var(--cs-text-muted)] hover:text-[var(--cs-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {isStaff && classTemplates.length > 0 && (
            <>
              <div className="px-1 pb-1 text-xs font-medium uppercase text-[var(--cs-text-muted)]">{t("inbox.classChannels")}</div>
              {classTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  disabled={creating}
                  onClick={() => openChannel(tpl.id)}
                  className="flex w-full items-center gap-2 rounded-[6px] px-2 py-2 text-left text-sm hover:bg-[var(--cs-bg)] disabled:opacity-50"
                >
                  <Radio className="h-4 w-4 text-[var(--cs-text-muted)]" /> {tpl.name}
                </button>
              ))}
              <div className="px-1 pb-1 pt-2 text-xs font-medium uppercase text-[var(--cs-text-muted)]">{t("inbox.directMessage")}</div>
            </>
          )}
          {loading ? (
            <div className="px-2 py-4 text-sm text-[var(--cs-text-muted)]">{t("common.loading")}</div>
          ) : contacts.length === 0 ? (
            <div className="px-2 py-4 text-sm text-[var(--cs-text-muted)]">{t("inbox.noContacts")}</div>
          ) : (
            contacts.map((c) => (
              <button
                key={c.userId}
                disabled={creating}
                onClick={() => startDm(c.userId, c.studentId)}
                className="flex w-full flex-col items-start rounded-[6px] px-2 py-2 text-left hover:bg-[var(--cs-bg)] disabled:opacity-50"
              >
                <span className="text-sm text-[var(--cs-text)]">{c.name}</span>
                {c.subtitle && <span className="text-xs text-[var(--cs-text-muted)]">{c.subtitle}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
