import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
  BookOpen,
  Layers,
  TrendingUp,
  Shield,
  GraduationCap,
  LayoutGrid,
  User as UserIcon,
} from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { debounce } from "../lib/debounce";

interface PaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Shared row / heading styling. Active row is accent-soft bg + accent text
// (direction.html); motion via the shell's --cs-motion-fast tier.
const ROW =
  "flex cursor-pointer items-center gap-3 rounded-[var(--cs-radius-control)] px-3 py-2 text-sm text-[var(--cs-text)] " +
  "transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] " +
  "data-[selected=true]:bg-[var(--cs-accent-soft)] data-[selected=true]:text-[var(--cs-accent)]";
const HEADING =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs " +
  "[&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-[var(--cs-text-muted)]";

// The palette is the primary navigation (DEV_PLAN E5.3): every workspace,
// every person, and the common create actions are one keystroke away.
export default function CommandPalette({ open, onOpenChange }: PaletteProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
        .eq("is_deleted", false) // archived/erased students are not jump-to targets (matches usePeople's active-list filter)
        .limit(50);
      if (cancelled) return;
      if (error) {
        setStudents([]);
        return;
      }
      setStudents((data || []).map((d) => ({ id: d.id, name: d.name || "Unnamed" })));
    };

    load();

    const debouncedLoad = debounce(load, 200);
    const channel = supabase
      .channel(`command-palette-students-${user.organizationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "students", filter: `organization_id=eq.${user.organizationId}` },
        debouncedLoad
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
        { label: t("nav.today"), to: "/app", icon: LayoutDashboard },
        { label: t("nav.schedule"), to: "/app/my-schedule", icon: Calendar },
        { label: t("nav.studyMaterial"), to: "/app/study-material", icon: BookOpen },
        { label: t("nav.academicProgress"), to: "/app/academic-progress", icon: GraduationCap },
        { label: t("nav.money"), to: "/app/money", icon: Wallet },
        { label: t("nav.inbox"), to: "/app/inbox", icon: MessageSquare },
        { label: t("nav.profile"), to: "/app/profile", icon: UserIcon },
      ];
    }
    const items = [
      { label: t("nav.today"), to: "/app", icon: LayoutDashboard },
      { label: t("nav.people"), to: "/app/people?lens=students", icon: Users },
      { label: t("nav.schedule"), to: "/app/schedule", icon: Calendar },
      { label: t("palette.courses"), to: "/app/courses", icon: Layers },
      { label: t("nav.money"), to: "/app/money", icon: Wallet },
      { label: t("nav.inbox"), to: "/app/inbox", icon: MessageSquare },
      { label: t("palette.leads"), to: "/app/people?lens=leads", icon: TrendingUp },
      { label: t("palette.tutors"), to: "/app/people?lens=tutors", icon: Shield },
      { label: t("palette.documents"), to: "/app/documents", icon: BookOpen },
      { label: t("common.settings"), to: "/app/settings", icon: Settings },
    ];
    items.push({ label: t("palette.componentKit"), to: "/app/kit", icon: LayoutGrid });
    return items;
  }, [isStaff, currentRole, t]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <Command
        label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] shadow-[var(--cs-shadow-pop)]"
        onKeyDown={(e) => { if (e.key === "Escape") onOpenChange(false); }}
      >
        <Command.Input
          autoFocus
          placeholder={t("common.search")}
          className="w-full border-b border-[var(--cs-border)] bg-transparent px-4 py-3 text-sm text-[var(--cs-text)] outline-none placeholder:text-[var(--cs-text-muted)]"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-[var(--cs-text-muted)]">
            {t("palette.empty")}
          </Command.Empty>

          <Command.Group heading={t("palette.goTo")} className={HEADING}>
            {navItems.map((item) => (
              <Command.Item
                key={item.to}
                value={`go ${item.label}`}
                onSelect={() => go(item.to)}
                className={ROW}
              >
                <item.icon className="h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                {item.label}
              </Command.Item>
            ))}
          </Command.Group>

          {isStaff && (
            <Command.Group heading={t("palette.create")} className={HEADING}>
              <Command.Item value="create new student" onSelect={() => go("/app/students?new=1")} className={ROW}>
                <UserPlus className="h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                {t("palette.newStudent")}
              </Command.Item>
              <Command.Item value="create schedule class" onSelect={() => go("/app/schedule?new=1")} className={ROW}>
                <CalendarPlus className="h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                {t("palette.scheduleClass")}
              </Command.Item>
              <Command.Item value="create new lead" onSelect={() => go("/app/leads?new=1")} className={ROW}>
                <TrendingUp className="h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                {t("palette.newLead")}
              </Command.Item>
            </Command.Group>
          )}

          {isStaff && students.length > 0 && (
            <Command.Group heading={t("palette.students")} className={HEADING}>
              {students.map((s) => (
                <Command.Item
                  key={s.id}
                  value={`student ${s.name}`}
                  onSelect={() => go(`/app/students/${s.id}`)}
                  className={ROW}
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
          <span>{t("palette.hint")}</span>
          <span>⌘K</span>
        </div>
      </Command>
    </div>
  );
}
