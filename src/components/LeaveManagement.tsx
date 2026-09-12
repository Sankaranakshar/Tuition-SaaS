import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { toast } from "sonner";
import {
  requestLeave, listLeaveRequests, decideLeaveRequest, getAffectedSessions, assignSubstitute,
  type LeaveRequestRow, type AffectedSessionRow,
} from "../lib/api";
import { Button } from "./kit";

const FIELD_CLASS =
  "mt-1 block w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] py-1.5 px-3 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30";

function formatDate(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
function formatDateTime(d: string): string {
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

interface TutorOption {
  userId: string;
  name: string;
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className="rounded-full bg-[var(--cs-surface-2)] px-2.5 py-0.5 text-xs font-medium capitalize text-[var(--cs-text-muted)]">
      {status}
    </span>
  );
}

/** Approved-leave row that lets staff find affected sessions and assign one
 *  substitute to all (or a chosen subset) of them in one go. */
function SubstituteAssignmentRow({ leave, tutors, onDone }: { leave: LeaveRequestRow; tutors: TutorOption[]; onDone: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [sessions, setSessions] = useState<AffectedSessionRow[] | null>(null);
  const [substituteId, setSubstituteId] = useState("");
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const substituteOptions = tutors.filter((t) => t.userId !== leave.tutorId);

  const loadSessions = async () => {
    setExpanded(true);
    if (sessions !== null) return;
    setLoading(true);
    try {
      const res = await getAffectedSessions(leave.id);
      setSessions(res.sessions);
    } catch (err: any) {
      toast.error("Could not load affected sessions", { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!substituteId) return;
    setAssigning(true);
    try {
      const res = await assignSubstitute(leave.id, substituteId);
      const failed = res.results.filter((r) => !r.ok);
      if (failed.length === 0) {
        toast.success(`Reassigned ${res.results.length} session(s)`);
      } else {
        toast.error(`${failed.length} of ${res.results.length} session(s) could not be reassigned`, {
          description: "The substitute already has a conflicting session at that time.",
        });
      }
      setSessions(null);
      setExpanded(false);
      onDone();
    } catch (err: any) {
      toast.error("Could not assign substitute", { description: err.message });
    } finally {
      setAssigning(false);
    }
  };

  return (
    <li className="py-3 text-sm">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[var(--cs-text)]">{formatDate(leave.startDate)} – {formatDate(leave.endDate)}</div>
          {leave.reason && <div className="text-xs text-[var(--cs-text-muted)]">{leave.reason}</div>}
        </div>
        <Button variant="ghost" onClick={loadSessions}>{expanded ? "Hide" : "Find affected sessions"}</Button>
      </div>
      {expanded && (
        <div className="mt-3 rounded-[var(--cs-radius-control)] bg-[var(--cs-surface-2)] p-3">
          {loading ? (
            <p className="text-xs text-[var(--cs-text-muted)]">Loading…</p>
          ) : sessions && sessions.length === 0 ? (
            <p className="text-xs text-[var(--cs-text-muted)]">No scheduled sessions fall in this leave window.</p>
          ) : (
            <>
              <ul className="space-y-1 text-xs text-[var(--cs-text-muted)]">
                {sessions?.map((s) => (
                  <li key={s.id}>{formatDateTime(s.startTime)} – {formatDateTime(s.endTime)}</li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-2">
                <select value={substituteId} onChange={(e) => setSubstituteId(e.target.value)} className={FIELD_CLASS}>
                  <option value="">Choose a substitute…</option>
                  {substituteOptions.map((t) => (
                    <option key={t.userId} value={t.userId}>{t.name}</option>
                  ))}
                </select>
                <Button onClick={handleAssign} disabled={!substituteId || assigning}>
                  {assigning ? "Assigning…" : "Assign to all"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

// B-13 (EXECUTION_PLAN.md Step 23): substitute and leave management. One
// tab covers both self-service (request/cancel your own leave, everyone in
// CAN_SCHEDULE) and staff review (approve/reject, then find the sessions an
// approved leave affects and assign a substitute) -- sections below are
// conditionally rendered by role rather than split into separate tabs, since
// even an approving owner/admin also wants to see and manage their own leave.
export default function LeaveManagement() {
  const { user } = useAuth();
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [myRequests, setMyRequests] = useState<LeaveRequestRow[]>([]);
  const [pending, setPending] = useState<LeaveRequestRow[]>([]);
  const [approved, setApproved] = useState<LeaveRequestRow[]>([]);
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(todayISO());
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = user?.organizationRole === "owner" || user?.organizationRole === "admin";
  const canManageSubstitutes = isAdmin || user?.organizationRole === "frontdesk";

  const load = useCallback(async () => {
    try {
      const mine = await listLeaveRequests();
      setMyRequests(mine.requests.filter((r) => r.tutorId === user?.id));
      if (isAdmin) {
        setPending(mine.requests.filter((r) => r.status === "pending"));
      }
      if (canManageSubstitutes) {
        setApproved(mine.requests.filter((r) => r.status === "approved"));
      }
    } catch (err: any) {
      toast.error("Could not load leave requests", { description: err.message });
    }
  }, [user?.id, isAdmin, canManageSubstitutes]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!canManageSubstitutes || !user?.organizationId) return;
    // No direct FK from organization_members to profiles for PostgREST to
    // embed on -- two queries + a client-side merge, same approach
    // TeamSettings.tsx/PayoutRuns.tsx already use.
    (async () => {
      const { data: rows } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", user.organizationId!)
        .eq("role", "tutor");
      const userIds = (rows || []).map((r: any) => r.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("id, name").in("id", userIds)
        : { data: [] as any[] };
      const nameById = new Map((profiles || []).map((p: any) => [p.id, p.name]));
      setTutors(userIds.map((id: string) => ({ userId: id, name: nameById.get(id) || "Unnamed" })));
    })();
  }, [canManageSubstitutes, user?.organizationId]);

  const handleRequest = async () => {
    setSubmitting(true);
    try {
      await requestLeave({ startDate, endDate, reason: reason.trim() || undefined });
      toast.success("Leave requested");
      setReason("");
      await load();
    } catch (err: any) {
      if (err.code === "invalid_range") {
        toast.error("End date must be on or after the start date");
      } else {
        toast.error("Could not request leave", { description: err.message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecide = async (id: string, action: "approve" | "reject" | "cancel") => {
    try {
      await decideLeaveRequest(id, action);
      toast.success(action === "approve" ? "Leave approved" : action === "reject" ? "Leave rejected" : "Leave cancelled");
      await load();
    } catch (err: any) {
      toast.error("Could not update leave request", { description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="border-b border-[var(--cs-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--cs-text)]">Request leave</h2>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Start date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={FIELD_CLASS} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--cs-text-muted)]">End date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={FIELD_CLASS} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Reason (optional)</label>
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} className={FIELD_CLASS} placeholder="Family event" />
            </div>
          </div>
          <Button onClick={handleRequest} disabled={submitting}>{submitting ? "Requesting…" : "Request leave"}</Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="border-b border-[var(--cs-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--cs-text)]">My leave requests</h2>
        </div>
        <div className="p-4">
          {myRequests.length === 0 ? (
            <p className="text-sm text-[var(--cs-text-muted)]">No leave requested yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--cs-border)]">
              {myRequests.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <div className="text-[var(--cs-text)]">{formatDate(r.startDate)} – {formatDate(r.endDate)}</div>
                    {r.reason && <div className="text-xs text-[var(--cs-text-muted)]">{r.reason}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={r.status} />
                    {r.status === "pending" && (
                      <Button variant="ghost" onClick={() => handleDecide(r.id, "cancel")}>Cancel</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {isAdmin && (
        <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
          <div className="border-b border-[var(--cs-border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--cs-text)]">Pending approvals</h2>
          </div>
          <div className="p-4">
            {pending.length === 0 ? (
              <p className="text-sm text-[var(--cs-text-muted)]">Nothing awaiting approval.</p>
            ) : (
              <ul className="divide-y divide-[var(--cs-border)]">
                {pending.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-3 text-sm">
                    <div>
                      <div className="text-[var(--cs-text)]">{formatDate(r.startDate)} – {formatDate(r.endDate)}</div>
                      {r.reason && <div className="text-xs text-[var(--cs-text-muted)]">{r.reason}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" onClick={() => handleDecide(r.id, "reject")}>Reject</Button>
                      <Button onClick={() => handleDecide(r.id, "approve")}>Approve</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {canManageSubstitutes && (
        <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
          <div className="border-b border-[var(--cs-border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--cs-text)]">Approved leave — assign a substitute</h2>
          </div>
          <div className="p-4">
            {approved.length === 0 ? (
              <p className="text-sm text-[var(--cs-text-muted)]">No approved leave needs a substitute right now.</p>
            ) : (
              <ul className="divide-y divide-[var(--cs-border)]">
                {approved.map((r) => (
                  <SubstituteAssignmentRow key={r.id} leave={r} tutors={tutors} onDone={load} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
