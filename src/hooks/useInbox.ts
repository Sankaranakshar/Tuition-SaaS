import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { useRealtimeList } from "./useRealtimeList";
import { ensureClassChannel as ensureClassChannelApi } from "../lib/api";
import type { InboxConversation, InboxMessage, InboxNotification, InboxTriageState, AnchorContext, AnchorType } from "../lib/inbox";

// Per-entity Inbox data hooks (DEV_PLAN §2a Stage 2 item 4, REDESIGN §6.5),
// mirroring usePeople.ts/useMoney.ts: each owns its query, bounding, Realtime
// subscription, and error state. conversations/inbox_state/notifications must
// already be in the supabase_realtime publication (20260711120100) or
// updates will silently no-op (HANDOFF §16.2's bug class).

export function useConversationsList() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<InboxConversation[]> => {
    if (!orgId || !user) return [];
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("organization_id", orgId)
      .contains("participant_ids", [user.id])
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      organizationId: row.organization_id,
      participantIds: row.participant_ids || [],
      kind: row.kind,
      anchorType: row.anchor_type,
      anchorId: row.anchor_id,
      createdAt: row.created_at,
    }));
  }, [orgId, user]);
  // Broad org-scoped subscription (postgres_changes filters can't express
  // array-contains); load() does the real participant filtering above.
  return useRealtimeList<InboxConversation>("inbox", "conversations", orgId, load);
}

export function useMessagesForConversation(conversationId: string | null | undefined) {
  const load = useCallback(async (): Promise<InboxMessage[]> => {
    if (!conversationId) return [];
    const { data, error } = await supabase
      .from("messages")
      .select("id, conversation_id, sender_id, receiver_id, body, read, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      conversationId: row.conversation_id,
      senderId: row.sender_id,
      receiverId: row.receiver_id,
      body: row.body,
      read: row.read,
      createdAt: row.created_at,
    }));
  }, [conversationId]);
  return useRealtimeList<InboxMessage>(
    "inbox",
    "messages",
    conversationId,
    load,
    conversationId ? `conversation_id=eq.${conversationId}` : undefined
  );
}

export function useNotificationsList() {
  const { user } = useAuth();
  const load = useCallback(async (): Promise<InboxNotification[]> => {
    if (!user) return [];
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      type: row.type,
      payload: row.payload || {},
      read: row.read,
      createdAt: row.created_at,
    }));
  }, [user]);
  return useRealtimeList<InboxNotification>("inbox", "notifications", user?.id, load, user ? `user_id=eq.${user.id}` : undefined);
}

export function useInboxStateMap() {
  const { user } = useAuth();
  const load = useCallback(async (): Promise<(InboxTriageState & { conversationId: string })[]> => {
    if (!user) return [];
    const { data, error } = await supabase.from("inbox_state").select("*").eq("user_id", user.id).limit(500);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      conversationId: row.conversation_id,
      archivedAt: row.archived_at,
      snoozedUntil: row.snoozed_until,
    }));
  }, [user]);
  const { data, loading, error, refetch } = useRealtimeList<InboxTriageState & { conversationId: string }>(
    "inbox",
    "inbox_state",
    user?.id,
    load,
    user ? `user_id=eq.${user.id}` : undefined
  );
  const map = new Map(data.map((row) => [row.conversationId, row]));
  return { map, loading, error, refetch };
}

// ---- Mutations --------------------------------------------------------------

export async function sendMessage(input: {
  organizationId: string;
  conversationId: string;
  senderId: string;
  receiverId?: string | null;
  body: string;
}) {
  const { error } = await supabase.from("messages").insert({
    organization_id: input.organizationId,
    conversation_id: input.conversationId,
    sender_id: input.senderId,
    receiver_id: input.receiverId ?? null,
    body: input.body,
    read: false,
  });
  if (error) throw error;
}

/** Finds or creates a DM conversation for exactly these two participants, optionally anchored to an entity. */
export async function findOrCreateDirectConversation(input: {
  organizationId: string;
  participantIds: [string, string];
  anchorType?: AnchorType;
  anchorId?: string;
}): Promise<string> {
  const { data: existing, error: findErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("kind", "dm")
    .contains("participant_ids", input.participantIds)
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) return existing.id;

  const { data: created, error: createErr } = await supabase
    .from("conversations")
    .insert({
      organization_id: input.organizationId,
      participant_ids: input.participantIds,
      kind: "dm",
      anchor_type: input.anchorType ?? null,
      anchor_id: input.anchorId ?? null,
    })
    .select("id")
    .single();
  if (createErr) throw createErr;
  return created.id;
}

async function upsertInboxState(conversationId: string, userId: string, patch: Partial<InboxTriageState>) {
  const row: Record<string, unknown> = {
    conversation_id: conversationId,
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  if ("archivedAt" in patch) row.archived_at = patch.archivedAt;
  if ("snoozedUntil" in patch) row.snoozed_until = patch.snoozedUntil;

  const { error } = await supabase.from("inbox_state").upsert(row, { onConflict: "conversation_id,user_id" });
  if (error) throw error;
}

export function archiveConversation(conversationId: string, userId: string) {
  return upsertInboxState(conversationId, userId, { archivedAt: new Date().toISOString() });
}

/** Undo for archiveConversation — REDESIGN §2's "undo, never confirm" rule. */
export function unarchiveConversation(conversationId: string, userId: string) {
  return upsertInboxState(conversationId, userId, { archivedAt: null });
}

export function snoozeConversation(conversationId: string, userId: string, until: Date) {
  return upsertInboxState(conversationId, userId, { snoozedUntil: until.toISOString() });
}

export async function markNotificationRead(notificationId: string) {
  const { error } = await supabase.from("notifications").update({ read: true }).eq("id", notificationId);
  if (error) throw error;
}

export const ensureClassChannel = ensureClassChannelApi;

// ---- Messageable contacts (New message picker) ------------------------------

export interface InboxContact {
  userId: string;
  name: string;
  role: "student" | "parent";
  subtitle?: string;
  studentId?: string;
}

/**
 * Contacts a "New message" picker can actually reach. The legacy Messaging.tsx
 * built its contact list from `students.id` and a synthetic `${id}_parent`
 * string and used those directly as `receiver_id` — neither is a real
 * `auth.users` id, so DMing a "contact" there would fail the FK constraint or
 * silently target the wrong row. This only lists people who have actually
 * redeemed an invite (a real `student_user_id`/`parent_user_id` exists).
 */
export function useMessageableContacts() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState<InboxContact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const orgId = user?.organizationId;
    if (!orgId || !user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      let studentsQuery = supabase
        .from("students")
        .select("id, name, student_user_id")
        .eq("organization_id", orgId)
        .eq("is_deleted", false)
        .not("student_user_id", "is", null)
        .limit(200);
      if (user.role === "tutor") studentsQuery = studentsQuery.eq("tutor_id", user.id);

      const [{ data: students, error: sErr }, { data: links, error: lErr }] = await Promise.all([
        studentsQuery,
        supabase.from("parent_links").select("parent_user_id, student_id").eq("organization_id", orgId).limit(500),
      ]);
      if (cancelled) return;
      if (sErr || lErr) {
        setLoading(false);
        return;
      }

      const studentContacts: InboxContact[] = (students || []).map((row: any) => ({
        userId: row.student_user_id,
        name: row.name,
        role: "student",
        studentId: row.id,
      }));

      const studentNameById = new Map((students || []).map((row: any) => [row.id, row.name]));
      const parentIds = Array.from(new Set((links || []).map((l: any) => l.parent_user_id)));
      const { data: profiles } = parentIds.length
        ? await supabase.from("profiles").select("id, name").in("id", parentIds)
        : { data: [] as any[] };
      const profileNameById = new Map((profiles || []).map((p: any) => [p.id, p.name]));

      const parentContacts: InboxContact[] = (links || []).map((row: any) => ({
        userId: row.parent_user_id,
        name: profileNameById.get(row.parent_user_id) || "Parent",
        role: "parent",
        subtitle: studentNameById.get(row.student_id) ? `Parent of ${studentNameById.get(row.student_id)}` : undefined,
        studentId: row.student_id,
      }));

      if (!cancelled) {
        setContacts([...studentContacts, ...parentContacts]);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  return { contacts, loading };
}

// ---- Anchor context resolution ----------------------------------------------

/** Resolves the entity behind a thread's anchor into the shape describeAnchor() needs, e.g. an invoice's student name or a homework item's due date. */
export function useAnchorContext(anchorType: AnchorType | null | undefined, anchorId: string | null | undefined) {
  const [context, setContext] = useState<AnchorContext>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!anchorType || !anchorId) {
      setContext({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        if (anchorType === "student") {
          const { data } = await supabase.from("students").select("id, name").eq("id", anchorId).maybeSingle();
          if (!cancelled) setContext({ student: data ? { id: data.id, name: data.name } : null });
        } else if (anchorType === "session") {
          const { data } = await supabase
            .from("class_sessions")
            .select("id, start_time, status")
            .eq("id", anchorId)
            .maybeSingle();
          if (!cancelled) setContext({ session: data ? { id: data.id, startTime: data.start_time, status: data.status } : null });
        } else if (anchorType === "invoice") {
          const { data } = await supabase.from("invoices").select("*").eq("id", anchorId).maybeSingle();
          if (!data) {
            if (!cancelled) setContext({ invoice: null });
            return;
          }
          const { data: student } = await supabase.from("students").select("name").eq("id", data.student_id).maybeSingle();
          if (!cancelled) {
            setContext({
              invoice: {
                id: data.id,
                studentId: data.student_id,
                status: data.status,
                dueDate: data.due_date,
                totalPaise: data.total_paise,
                paidPaise: data.paid_paise,
                studentName: student?.name,
              },
            });
          }
        } else if (anchorType === "homework") {
          const { data } = await supabase
            .from("assessments")
            .select("id, title, due_date, status")
            .eq("id", anchorId)
            .maybeSingle();
          if (!cancelled) {
            setContext({
              homework: data ? { id: data.id, title: data.title, dueDate: data.due_date, status: data.status } : null,
            });
          }
        } else if (anchorType === "class") {
          const { data } = await supabase.from("class_templates").select("id, name").eq("id", anchorId).maybeSingle();
          if (!cancelled) setContext({ classTemplate: data ? { id: data.id, name: data.name } : null });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [anchorType, anchorId]);

  return { context, loading };
}
