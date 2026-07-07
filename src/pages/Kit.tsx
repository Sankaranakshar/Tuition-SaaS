import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Inbox, Receipt, Users, MessageSquare, Phone } from "lucide-react";
import {
  EmptyState,
  Skeleton,
  SkeletonText,
  SkeletonRow,
  SkeletonCard,
  StatChip,
  StatusChip,
  AgedBadge,
  PersonRow,
  ContextCard,
  CapacityMeter,
  PopoverEdit,
} from "@/components/kit";
import { formatINR } from "@/lib/format";

// Storybook-style demo route (DEV_PLAN E5.4 acceptance): every kit component
// in every meaningful state, so regressions are visible at a glance. Reachable
// at /app/kit and via the command palette ("kit").
export default function Kit() {
  const [amount, setAmount] = useState("3000");

  return (
    <div className="mx-auto max-w-4xl space-y-10 pb-16">
      <header>
        <h1 className="text-xl font-semibold text-[var(--cs-text)]">Component kit</h1>
        <p className="mt-1 text-sm text-[var(--cs-text-muted)]">
          The shared vocabulary (DEV_PLAN E5.4). Every state rendered here.
        </p>
      </header>

      <Section title="StatChip">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatChip label="Collected this month" value={formatINR(84500)} hint="vs ₹71,200 last month" tone="positive" icon={Receipt} />
          <StatChip label="Outstanding" value={formatINR(27300)} hint="6 invoices" tone="warn" />
          <StatChip label="Overdue 30+ days" value={formatINR(4500)} hint="3 parents" tone="danger" />
          <StatChip label="Sessions this week" value={18} hint="+3 vs last week" />
          <StatChip label="Active students" value={126} onClick={() => toast("Would open People")} />
        </div>
      </Section>

      <Section title="StatusChip">
        <div className="flex flex-wrap gap-2">
          <StatusChip label="Enrolled" tone="positive" />
          <StatusChip label="Trial" tone="accent" />
          <StatusChip label="At risk" tone="warn" />
          <StatusChip label="Overdue" tone="danger" />
          <StatusChip label="Lead" tone="neutral" />
          <StatusChip label="No dot" tone="neutral" dot={false} />
        </div>
      </Section>

      <Section title="AgedBadge">
        <div className="flex flex-wrap gap-2">
          <AgedBadge daysOverdue={-2} />
          <AgedBadge daysOverdue={3} />
          <AgedBadge daysOverdue={14} />
          <AgedBadge daysOverdue={42} />
        </div>
      </Section>

      <Section title="PersonRow">
        <div className="divide-y divide-[var(--cs-border)] rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
          <PersonRow
            name="Riya Sharma"
            subtitle="Paid ₹3,000 · 2 days ago"
            status={{ label: "Enrolled", tone: "positive" }}
            onClick={() => toast("Open Riya's story")}
            actions={<RowAction icon={MessageSquare} label="Message" />}
          />
          <PersonRow
            name="Aarav Mehta"
            subtitle="Missed 3 sessions in a row"
            status={{ label: "At risk", tone: "warn" }}
            onClick={() => {}}
            actions={<RowAction icon={Phone} label="Call parent" />}
          />
          <PersonRow
            name="Mrs. Kapoor"
            subtitle="Inquiry · last touched 6 days ago"
            status={{ label: "Lead", tone: "neutral" }}
            selected
          />
        </div>
      </Section>

      <Section title="ContextCard">
        <div className="space-y-2">
          <ContextCard icon={Receipt} title="Invoice #142" detail="₹3,000 · overdue 6 days" tone="danger" action={<RowAction icon={Receipt} label="Record payment" />} />
          <ContextCard icon={Users} title="Class 10 Maths batch" detail="12 students · Mon/Wed/Fri 5:00 pm" />
        </div>
      </Section>

      <Section title="CapacityMeter">
        <div className="max-w-xs space-y-3">
          <CapacityMeter filled={3} capacity={8} />
          <CapacityMeter filled={7} capacity={8} />
          <CapacityMeter filled={9} capacity={8} />
          <CapacityMeter filled={5} capacity={10} compact />
        </div>
      </Section>

      <Section title="PopoverEdit">
        <div className="flex items-center gap-2 text-sm text-[var(--cs-text-muted)]">
          Fee amount:
          <PopoverEdit
            value={amount}
            label="Amount (₹)"
            type="number"
            onSave={(next) => {
              setAmount(next);
              toast.success(`Saved ${formatINR(Number(next))}`);
            }}
            validate={(next) => (Number(next) <= 0 ? "Enter an amount greater than zero." : null)}
          />
        </div>
      </Section>

      <Section title="Skeleton">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
            <SkeletonRow />
            <SkeletonRow />
          </div>
          <SkeletonCard />
          <div className="space-y-3">
            <Skeleton className="h-8 w-32" />
            <SkeletonText lines={4} />
          </div>
        </div>
      </Section>

      <Section title="EmptyState">
        <div className="grid gap-4 sm:grid-cols-2">
          <EmptyState
            icon={Inbox}
            title="All clear"
            description="Nothing needs you right now. Next class at 4:00 pm."
          />
          <EmptyState
            icon={Users}
            title="No students yet"
            description="Add your first student or import a class list to get started."
            action={{ label: "Add student", onClick: () => toast("New student") }}
            example={{ label: "See a sample", onClick: () => toast("Sample") }}
          />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--cs-text-muted)]">{title}</h2>
      {children}
    </section>
  );
}

function RowAction({ icon: Icon, label }: { icon: typeof MessageSquare; label: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        toast(label);
      }}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[var(--cs-text-muted)] hover:bg-[var(--cs-surface)] hover:text-[var(--cs-text)]"
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );
}
