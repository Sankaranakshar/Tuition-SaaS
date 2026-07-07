import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import {
  LayoutDashboard,
  Users,
  Calendar,
  Settings,
  LogOut,
  Bell,
  Search,
  MessageSquare,
  Wallet,
  BookOpen,
  ChevronDown,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import CommandPalette from "./CommandPalette";

// The shell (DEV_PLAN E5.2): a 56px icon rail with five workspaces plus
// settings, and a topbar whose search box is a real command palette
// trigger. Everything else lives one keystroke away (Cmd+K).
export default function Layout() {
  const { user, logout, currentRole, setCurrentRole } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowRoleDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const isStudent = currentRole === "student";

  // Five workspaces. Leads, Documents, Admin are reachable via the palette;
  // the rail stays furniture, not a table of contents.
  const rail = isStudent
    ? [
        { to: "/app", label: t("nav.today"), icon: LayoutDashboard, end: true },
        { to: "/app/timetable", label: t("nav.schedule"), icon: Calendar },
        { to: "/app/study-material", label: t("nav.learn"), icon: BookOpen },
        { to: "/app/wallet", label: t("nav.money"), icon: Wallet },
        { to: "/app/messaging", label: t("nav.inbox"), icon: MessageSquare },
      ]
    : [
        { to: "/app", label: t("nav.today"), icon: LayoutDashboard, end: true },
        { to: "/app/students", label: t("nav.people"), icon: Users },
        { to: "/app/calendar", label: t("nav.schedule"), icon: Calendar },
        { to: "/app/invoices", label: t("nav.money"), icon: Wallet },
        { to: "/app/messaging", label: t("nav.inbox"), icon: MessageSquare },
      ];

  const settingsPath = isStudent ? "/app/preferences" : "/app/settings";

  return (
    <div className="flex h-screen bg-[var(--cs-bg)] font-sans">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      {/* Icon rail */}
      <aside className="flex w-14 flex-col items-center border-r border-[var(--cs-border)] bg-[var(--cs-surface)] py-3">
        <button
          onClick={() => navigate("/app")}
          className="mb-4 flex h-8 w-8 items-center justify-center rounded-[6px] bg-[var(--cs-accent)] text-sm font-semibold text-white"
          title="ClassStackr"
        >
          c
        </button>

        <nav className="flex flex-1 flex-col items-center gap-1">
          {rail.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={(item as any).end}
              title={item.label}
              className={({ isActive }) =>
                `group relative flex h-10 w-10 items-center justify-center rounded-[6px] transition-colors ${
                  isActive
                    ? "bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]"
                    : "text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)] hover:text-[var(--cs-text)]"
                }`
              }
            >
              <item.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
              <span className="pointer-events-none absolute left-12 z-20 hidden whitespace-nowrap rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] px-2 py-1 text-xs text-[var(--cs-text)] shadow-sm group-hover:block">
                {item.label}
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="flex flex-col items-center gap-1">
          <NavLink
            to={settingsPath}
            title={t("common.settings")}
            className={({ isActive }) =>
              `flex h-10 w-10 items-center justify-center rounded-[6px] transition-colors ${
                isActive
                  ? "bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]"
                  : "text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)] hover:text-[var(--cs-text)]"
              }`
            }
          >
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </NavLink>
          <button
            onClick={handleLogout}
            title={t("common.logOut")}
            className="flex h-10 w-10 items-center justify-center rounded-[6px] text-[var(--cs-text-muted)] transition-colors hover:bg-[var(--cs-bg)] hover:text-[var(--cs-text)]"
          >
            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b border-[var(--cs-border)] bg-[var(--cs-surface)] px-4">
          {/* Real palette trigger where the fake search box used to be */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex w-72 items-center gap-2 rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-bg)] px-3 py-1.5 text-sm text-[var(--cs-text-muted)] transition-colors hover:border-[var(--cs-accent)]"
          >
            <Search className="h-4 w-4" strokeWidth={1.75} />
            <span className="flex-1 text-left">{t("common.search")}</span>
            <kbd className="rounded border border-[var(--cs-border)] bg-[var(--cs-surface)] px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/app/notifications")}
              className="relative flex h-9 w-9 items-center justify-center rounded-[6px] text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)] hover:text-[var(--cs-text)]"
              title={t("common.notifications")}
            >
              <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>

            <div className="relative flex items-center" ref={dropdownRef}>
              <button
                onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                className="flex items-center gap-2 rounded-[6px] px-2 py-1 hover:bg-[var(--cs-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent)]"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--cs-accent-soft)] text-xs font-semibold text-[var(--cs-accent)]">
                  {user?.name?.charAt(0).toUpperCase()}
                </div>
                <div className="hidden flex-col items-start sm:flex">
                  <span className="text-sm font-medium leading-tight text-[var(--cs-text)]">{user?.name}</span>
                  <span className="text-[11px] capitalize text-[var(--cs-text-muted)]">{currentRole}</span>
                </div>
                {user?.roles && user.roles.length > 1 && (
                  <ChevronDown className="h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                )}
              </button>

              {showRoleDropdown && user?.roles && user.roles.length > 1 && (
                <div className="absolute right-0 top-full z-10 mt-2 w-48 rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-1 shadow-lg">
                  <div className="border-b border-[var(--cs-border)] px-4 py-2 text-xs font-medium text-[var(--cs-text-muted)]">
                    {t("common.switchPortal")}
                  </div>
                  {user.roles.map((role) => (
                    <button
                      key={role}
                      onClick={() => {
                        setCurrentRole(role);
                        setShowRoleDropdown(false);
                        navigate("/app");
                      }}
                      className={`w-full px-4 py-2 text-left text-sm capitalize ${
                        currentRole === role
                          ? "bg-[var(--cs-accent-soft)] font-medium text-[var(--cs-accent)]"
                          : "text-[var(--cs-text)] hover:bg-[var(--cs-bg)]"
                      }`}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
