import { Fragment, useEffect, useState } from "react";
import { ClipboardList, ChevronDown, ChevronRight } from "lucide-react";
import { listAuditEvents, listOrgsForAdmin } from "../lib/api";
import type { AuditEvent } from "../../shared/schemas/auditLog";
import type { OrgHealth } from "../../shared/schemas/admin";
import { useIsPlatformAdmin } from "../hooks/usePlatformAdmin";
import { formatDate, formatTime } from "../lib/format";
import { EmptyState, SkeletonRow } from "../components/kit";

const PAGE_SIZE = 50;

// Tech Debt #31 / old Epic 16.4: read-only view over audit_events. Gated
// exactly like server/routes/auditLog.ts — a platform admin sees every org
// (with an org filter) via the same requirePlatformAdmin-style check the
// server also runs; anyone else only ever gets their own org's rows back
// (the server pins orgId to req.user.organizationId regardless of what this
// page sends), so the org filter below is inert for non-platform-admins.
export default function AuditLog() {
  const isPlatformAdmin = useIsPlatformAdmin();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [orgs, setOrgs] = useState<OrgHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [orgId, setOrgId] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    listOrgsForAdmin().then((res) => setOrgs(res.orgs)).catch(() => {});
  }, [isPlatformAdmin]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    listAuditEvents({
      orgId: orgId || undefined,
      entityType: entityType || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then((res) => {
        setEvents(res.events);
        setTotal(res.total);
      })
      .catch((err) => setError(err?.message || "Failed to load the audit log"))
      .finally(() => setLoading(false));
  }, [orgId, entityType, from, to, offset]);

  const resetAndSet = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setOffset(0);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Audit log</h1>
        <p className="text-sm text-gray-500">
          {isPlatformAdmin
            ? "Every privileged mutation across every organization, newest first."
            : "Every privileged mutation in your organization, newest first."}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        {isPlatformAdmin && (
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            Organization
            <select
              value={orgId}
              onChange={(e) => resetAndSet(setOrgId)(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
            >
              <option value="">All organizations</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          Entity type
          <input
            type="text"
            placeholder="e.g. invoices"
            value={entityType}
            onChange={(e) => resetAndSet(setEntityType)(e.target.value)}
            className="w-36 rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => resetAndSet(setFrom)(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => resetAndSet(setTo)(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2">When</th>
              {isPlatformAdmin && <th className="px-4 py-2">Organization</th>}
              <th className="px-4 py-2">Actor</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Entity</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}><td colSpan={isPlatformAdmin ? 6 : 5} className="px-4 py-3"><SkeletonRow /></td></tr>
            ))}
            {!loading && events.length === 0 && (
              <tr>
                <td colSpan={isPlatformAdmin ? 6 : 5}>
                  <EmptyState icon={ClipboardList} title="No matching events" description="Nothing has happened yet for this filter." />
                </td>
              </tr>
            )}
            {events.map((event) => {
              const isExpanded = expandedId === event.id;
              return (
                <Fragment key={event.id}>
                  <tr
                    className="cursor-pointer hover:bg-gray-50"
                    onClick={() => setExpandedId(isExpanded ? null : event.id)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">
                      {formatDate(event.createdAt)} <span className="text-gray-400">{formatTime(event.createdAt)}</span>
                    </td>
                    {isPlatformAdmin && (
                      <td className="px-4 py-3 text-gray-600">{event.organizationName ?? event.organizationId}</td>
                    )}
                    <td className="px-4 py-3 text-gray-600">
                      {/* A system actor (payment webhook, scheduler) has no
                          auth user behind it, so actorName/actorEmail are
                          always null — show which system acted rather than
                          falling through to the bare "System" that a deleted
                          user also lands on. */}
                      {event.systemActor ? (
                        <span className="font-mono text-xs text-gray-500">{event.systemActor}</span>
                      ) : (
                        event.actorName || event.actorEmail || "System"
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{event.action}</td>
                    <td className="px-4 py-3 text-gray-600">
                      {event.entityType ? `${event.entityType}${event.entityId ? ` · ${event.entityId.slice(0, 8)}` : ""}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400">
                      {isExpanded ? <ChevronDown className="ml-auto h-4 w-4" /> : <ChevronRight className="ml-auto h-4 w-4" />}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={isPlatformAdmin ? 6 : 5} className="bg-gray-50 px-4 py-3">
                        <pre className="whitespace-pre-wrap break-all text-xs text-gray-600">
                          {JSON.stringify(event.payload, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="rounded-md border border-gray-300 px-3 py-1 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
