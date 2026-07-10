import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import {
  LayoutDashboard,
  Users,
  Calendar,
  Wallet,
  MessageSquare,
  Settings,
  UserPlus,
  CalendarPlus,
  Receipt,
  BookOpen,
  Layers,
  TrendingUp,
  Shield,
  GraduationCap,
  Bell,
  LayoutGrid,
  User as UserIcon,
} from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";

interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// The palette is the primary navigation (DEV_PLAN E5.3): every workspace,
// every person, and the common create actions are one keystroke away.
export default function CommandPalette({ open, onOpenChange }: PaletteProps) {
  const navigate = useNavigate();
  const { user, currentRole } = useAuth();
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);

  // Global shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [open, onOpenChange]);

  // Org roster for jump-to-person; bounded, staff only.
  const isStaff = currentRole !== "student" && currentRole !== "parent";
  useEffect(() => {
    if (!open || !isStaff || !user?.organizationId) return;
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, name")
        .eq("organization_id", user.organizationId)
        .limit(50);
      if (cancelled) return;
      if (error) {
        setStudents([]);
        return;
      }
      setStudents((data || []).map((d) => ({ id: d.id, name: d.name || "Unnamed" })));
    };

    load();

    const channel = supabase
      .channel(`command-palette-students-${user.organizationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "students", filter: `organization_id=eq.${user.organizationId}` },
        load
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [open, isStaff, user?.organizationId]);

  const go = (to: string) => {
    onOpenChange(false);
    navigate(to);
  };

  const navItems = useMemo(() => {
    if (!isStaff) {
      return [
        { label: "Today", to: "/app", icon: LayoutDashboard },
        { label: "Timetable", to: "/app/timetable", icon: Calendar },
        { label: "Study material", to: "/app/study-material", icon: BookOpen },
        { label: "Academic progress", to: "/app/academic-progress", icon: GraduationCap },
        { label: "Wallet", to: "/app/wallet", icon: Wallet },
        { label: "Transactions", to: "/app/transactions", icon: Receipt },
        { label: "Messages", to: "/app/messaging", icon: MessageSquare },
        { label: "Notifications", to: "/app/notifications", icon: Bell },
        { label: "Profile", to: "/app/profile", icon: UserIcon },
      ];
    }
    const items = [
      { label: "Today", to: "/app", icon: LayoutDashboard },
      { label: "Students", to: "/app/students", icon: Users },
      { label: "Calendar", to: "/app/calendar", icon: Calendar },
      { label: "Courses", to: "/app/courses", icon: Layers },
      { label: "Money", to: "/app/invoices", icon: Wallet },
      { label: "Messages", to: "/app/messaging", icon: MessageSquare },
      { label: "Leads", to: "/app/leads", icon: TrendingUp },
      { label: "Documents", to: "/app/documents", icon: BookOpen },
      { label: "Settings", to: "/app/settings", icon: Settings },
    ];
    if (currentRole === "admin") items.push({ label: "Admin panel", to: "/app/admin", icon: Shield });
    items.push({ label: "Component kit", to: "/app/kit", icon: LayoutGrid });
    return items;
  }, [isStaff, currentRole]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <Command
        label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] shadow-2xl"
        onKeyDown={(e) => { if (e.key === "Escape") onOpenChange(false); }}
      >
        <Command.Input
          autoFocus
          placeholder="Search or jump to…"
          className="w-full border-b border-[var(--cs-border)] bg-transparent px-4 py-3 text-sm text-[var(--cs-text)] outline-none placeholder:text-[var(--cs-text-muted)]"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-[var(--cs-text-muted)]">
            Nothing matches.
          </Command.Empty>

          <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[var(--cs-text-muted)]">
            {navItems.map((item) => (
              <Command.Item
                key={item.to}
                value={`go ${item.label}`}
                onSelect={() => go(item.to)}
                className="flex cursor-pointer items-center gap-3 rounded-[6px] px-3 py-2 text-sm text-[var(--cs-text)] data-[selected=true]:bg-[var(--cs-accent-soft)]"
              >
                <item.icon className="h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                {item.label}
              </Command.Item>
            ))}
          </Command.Group>

          {isStaff && (
            <Command.Group heading="Create" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[var(--cs-text-muted)]">
              <Command.Item value="create new student" onSelect={() => go("/app/students?new=1")}
                className="flex cursor-pointer items-center gap-3 rounded-[6px] px-3 py-2 text-sm text-[var(--cs-text)] data-[selected=true]:bg-[var(--cs-accent-soft)]">
                <UserPlus className="h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                New student
              </Command.Item>
              <Command.Item value="create schedule class" onSelect={() => go("/app/calendar?new=1")}
                className="flex cursor-pointer items-center gap-3 rounded-[6px] px-3 py-2 text-sm text-[var(--cs-text)] data-[selected=true]:bg-[var(--cs-accent-soft)]">
                <CalendarPlus className="h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                Schedule a class
              </Command.Item>
              <Command.Item value="create new lead" onSelect={() => go("/app/leads?new=1")}
                className="flex cursor-pointer items-center gap-3 rounded-[6px] px-3 py-2 text-sm text-[var(--cs-text)] data-[selected=true]:bg-[var(--cs-accent-soft)]">
                <TrendingUp className="h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                New lead
              </Command.Item>
            </Command.Group>
          )}

          {isStaff && students.length > 0 && (
            <Command.Group heading="Students" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[var(--cs-text-muted)]">
              {students.map((s) => (
                <Command.Item
                  key={s.id}
                  value={`student ${s.name}`}
                  onSelect={() => go(`/app/students/${s.id}`)}
                  className="flex cursor-pointer items-center gap-3 rounded-[6px] px-3 py-2 text-sm text-[var(--cs-text)] data-[selected=true]:bg-[var(--cs-accent-soft)]"
                >
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--cs-accent-soft)] text-[10px] font-semibold text-[var(--cs-accent)]">
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  {s.name}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
        <div className="flex items-center justify-between border-t border-[var(--cs-border)] px-4 py-2 text-[11px] text-[var(--cs-text-muted)]">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>⌘K</span>
        </div>
      </Command>
    </div>
  );
}
