import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { X } from "lucide-react";
import { supabase } from "../supabase";
import { EmptyState, SkeletonRow, Modal } from "./kit";
import { Inbox as InboxIcon } from "lucide-react";
import { formatDate, formatTime } from "../lib/format";
import {
  listBookingRequests,
  acceptBookingRequest,
  declineBookingRequest,
  proposeBookingAlternative,
  type BookingRequestRow,
} from "../lib/api";

// Staff-facing side of the booking-request approval flow (EXECUTION_PLAN.md
// Step 5): a pending-requests list with popover-first accept/decline/
// propose-alternative actions (REDESIGN.md §10). Rendered as Inbox's
// "Requests" segment rather than merged into the conversations/notifications
// list — a booking request isn't a thread, and forcing it into that shape
// would risk the working sortInboxItems/notification machinery for no
// benefit. The requester's own response to a counter-offer is a separate,
// code-reviewed-only surface (ParentPortal) — no demo parent account exists
// to browser-verify it, same convention as this codebase's other
// parent/student-only screens.
export function BookingRequestsPanel({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const [requests, setRequests] = useState<BookingRequestRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [proposeMode, setProposeMode] = useState<null | "template" | "time">(null);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const res = await listBookingRequests("pending").catch(() => null);
    setRequests(res?.requests ?? []);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    if (proposeMode !== "template") return;
    supabase
      .from("class_templates")
      .select("id, name")
      .eq("organization_id", orgId)
      .limit(200)
      .then(({ data }) => setTemplates(data || []));
  }, [proposeMode, orgId]);

  const open = requests?.find((r) => r.id === openId) ?? null;

  async function runAction(fn: () => Promise<unknown>, successMsg: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(successMsg);
      setOpenId(null);
      setProposeMode(null);
      await reload();
    } catch (err: any) {
      toast.error(err?.message || t("inbox.requestActionFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (requests === null) {
    return <div className="divide-y divide-[var(--cs-border)]">{Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}</div>;
  }

  if (requests.length === 0) {
    return <EmptyState icon={InboxIcon} title={t("inbox.requestsEmpty")} description={t("inbox.requestsEmptyHint")} />;
  }

  return (
    <div className="mx-auto max-w-2xl divide-y divide-[var(--cs-border)] overflow-y-auto">
      {requests.map((r) => (
        <button
          key={r.id}
          onClick={() => setOpenId(r.id)}
          className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-[var(--cs-surface-hover,#f9fafb)]"
        >
          <div className="text-sm font-medium text-[var(--cs-text)]">
            {r.requested_by_name || t("common.unknown")} — {r.student_name}
          </div>
          <div className="text-sm text-[var(--cs-text-muted)]">
            {r.template_id
              ? `${t("inbox.requestWantsClass")} ${r.template_name}`
              : `${t("inbox.requestWantsTutor")} ${r.tutor_name}, ${formatDate(r.requested_start_time!)} ${formatTime(r.requested_start_time!)}`}
          </div>
          {r.notes && <div className="text-xs text-[var(--cs-text-muted)]">{t("inbox.requestNotes")}: {r.notes}</div>}
        </button>
      ))}

      {open && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={() => { setOpenId(null); setProposeMode(null); }}>
          <Modal
            onClose={() => { setOpenId(null); setProposeMode(null); }}
            labelledBy="booking-request-title"
            className="w-96 rounded-lg border border-[var(--cs-border)] bg-white p-4 shadow-xl"
          >
            <div className="mb-3 flex items-start justify-between">
              <h3 id="booking-request-title" className="font-semibold text-[var(--cs-text)]">
                {open.requested_by_name} — {open.student_name}
              </h3>
              <button onClick={() => { setOpenId(null); setProposeMode(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mb-4 space-y-1 text-sm text-[var(--cs-text-muted)]">
              <div>
                {open.template_id
                  ? `${t("inbox.requestWantsClass")} ${open.template_name}`
                  : `${t("inbox.requestWantsTutor")} ${open.tutor_name}, ${formatDate(open.requested_start_time!)} ${formatTime(open.requested_start_time!)}–${formatTime(open.requested_end_time!)}`}
              </div>
              {open.notes && <div>{t("inbox.requestNotes")}: {open.notes}</div>}
            </div>

            {proposeMode === null ? (
              <div className="flex flex-col gap-2">
                <button
                  disabled={busy}
                  onClick={() => runAction(() => acceptBookingRequest(open.id), t("inbox.requestAccepted"))}
                  className="w-full rounded bg-[var(--cs-accent)] py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {t("inbox.requestAccept")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => setProposeMode(open.template_id ? "template" : "time")}
                  className="w-full rounded border border-[var(--cs-border)] py-1.5 text-sm font-medium text-[var(--cs-text)] hover:bg-gray-50 disabled:opacity-50"
                >
                  {t("inbox.requestPropose")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => runAction(() => declineBookingRequest(open.id), t("inbox.requestDeclined"))}
                  className="w-full rounded bg-[var(--cs-danger)]/10 py-1.5 text-sm font-medium text-[var(--cs-danger)] hover:bg-[var(--cs-danger)]/20 disabled:opacity-50"
                >
                  {t("inbox.requestDecline")}
                </button>
              </div>
            ) : proposeMode === "template" ? (
              <ProposeTemplateForm
                templates={templates.filter((tpl) => tpl.id !== open.template_id)}
                busy={busy}
                onCancel={() => setProposeMode(null)}
                onSubmit={(templateId) =>
                  runAction(() => proposeBookingAlternative(open.id, { proposedTemplateId: templateId }), t("inbox.requestProposed"))
                }
              />
            ) : (
              <ProposeTimeForm
                busy={busy}
                onCancel={() => setProposeMode(null)}
                onSubmit={(start, end) =>
                  runAction(
                    () => proposeBookingAlternative(open.id, { proposedStartTime: start, proposedEndTime: end }),
                    t("inbox.requestProposed")
                  )
                }
              />
            )}
          </Modal>
        </div>
      )}
    </div>
  );
}

function ProposeTemplateForm({
  templates, busy, onCancel, onSubmit,
}: {
  templates: { id: string; name: string }[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (templateId: string) => void;
}) {
  const { t } = useTranslation();
  const [templateId, setTemplateId] = useState(templates[0]?.id || "");
  // Templates load asynchronously after this form mounts (the parent only
  // fetches them once proposeMode becomes "template"), so the initial
  // useState above often runs before the list arrives. Sync once it does,
  // rather than leaving the submit button permanently disabled until the
  // popover is closed and reopened.
  useEffect(() => {
    if (!templateId && templates.length > 0) setTemplateId(templates[0].id);
  }, [templates, templateId]);
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-[var(--cs-text-muted)]">{t("inbox.requestProposeTemplatePrompt")}</label>
      <select
        value={templateId}
        onChange={(e) => setTemplateId(e.target.value)}
        className="rounded border border-[var(--cs-border)] px-2 py-1.5 text-sm"
      >
        {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
      </select>
      <div className="mt-1 flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded border border-[var(--cs-border)] py-1.5 text-sm font-medium text-[var(--cs-text)] hover:bg-gray-50">
          {t("inbox.requestCancel")}
        </button>
        <button
          disabled={busy || !templateId}
          onClick={() => onSubmit(templateId)}
          className="flex-1 rounded bg-[var(--cs-accent)] py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {t("inbox.requestPropose")}
        </button>
      </div>
    </div>
  );
}

function ProposeTimeForm({
  busy, onCancel, onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (startTime: string, endTime: string) => void;
}) {
  const { t } = useTranslation();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const valid = !!start && !!end && new Date(end).getTime() > new Date(start).getTime();
  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-medium text-[var(--cs-text-muted)]">{t("inbox.requestProposeTimePrompt")}</label>
      <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="rounded border border-[var(--cs-border)] px-2 py-1.5 text-sm" />
      <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded border border-[var(--cs-border)] px-2 py-1.5 text-sm" />
      <div className="mt-1 flex gap-2">
        <button onClick={onCancel} className="flex-1 rounded border border-[var(--cs-border)] py-1.5 text-sm font-medium text-[var(--cs-text)] hover:bg-gray-50">
          {t("inbox.requestCancel")}
        </button>
        <button
          disabled={busy || !valid}
          onClick={() => onSubmit(new Date(start).toISOString(), new Date(end).toISOString())}
          className="flex-1 rounded bg-[var(--cs-accent)] py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {t("inbox.requestPropose")}
        </button>
      </div>
    </div>
  );
}
