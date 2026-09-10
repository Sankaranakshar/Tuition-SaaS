import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";
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
  ShieldAlert,
  ClipboardList,
  MoreHorizontal,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import CommandPalette from "./CommandPalette";
import { BottomSheet } from "./kit";
import { useNotificationsList } from "../hooks/useInbox";
import { useIsPlatformAdmin } from "../hooks/usePlatformAdmin";

// The shell (DEV_PLAN E5.2): a ~92px labelled rail with five workspaces plus
// utility items, and a topbar whose search box is a real command palette
// trigger. Everything else lives one keystroke away (Cmd+K). The rail's top
// reserves a dashed org-switcher slot, wired in R2 (B-06 / B-07).
const RAIL_ITEM =
  "group flex w-full flex-col items-center gap-1 rounded-[var(--cs-radius-control)] px-1 py-2 " +
  "text-center text-[11px] font-medium leading-tight " +
  "transition-[background-color,color] duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)]";
const RAIL_ON = "bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]";
const RAIL_OFF =
  "text-[var(--cs-text-muted)] hover:bg-[var(--cs-surface-2)] hover:text-[var(--cs-text)]";
const railClass = ({ isActive }: { isActive: boolean }) =>
  `${RAIL_ITEM} ${isActive ? RAIL_ON : RAIL_OFF}`;

export default function Layout() {
  const { user, logout, currentRole, setCurrentRole } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { data: notifications } = useNotificationsList();
  const unreadCount = notifications.filter((n) => !n.read).length;
  const isPlatformAdmin = useIsPlatformAdmin();

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
  const isParent = currentRole === "parent";
  // Server-side gating (owner/admin/accountant, or the platform-admin
  // allowlist) is the real boundary (see server/routes/auditLog.ts). This
  // only decides whether the rail icon renders at all, same caveat as
  // isPlatformAdmin below.
  const isStaff = !isStudent && !isParent;

  // Five workspaces. Documents is reachable via the palette; the rail stays
  // furniture, not a table of contents. Leads and tutor verification are
  // lenses inside Students now (REDESIGN §6.2), not separate destinations.
  // Parents get a deliberately short rail (Epic 10): their children overview
  // holds schedule/invoices/wallet as tabs, so there's nothing else to
  // navigate to. Route paths are unchanged (/app/people, /app/schedule); the
  // rename is labels only.
  const rail = isStudent
    ? [
        { to: "/app", label: t("nav.today"), icon: LayoutDashboard, end: true },
        { to: "/app/my-schedule", label: t("nav.schedule"), icon: Calendar },
        { to: "/app/my-story", label: t("nav.learn"), icon: BookOpen },
        { to: "/app/money", label: t("nav.money"), icon: Wallet },
        { to: "/app/inbox", label: t("nav.inbox"), icon: MessageSquare },
      ]
    : isParent
    ? [
        { to: "/app", label: "My children", icon: LayoutDashboard, end: true },
        { to: "/app/inbox", label: t("nav.inbox"), icon: MessageSquare },
      ]
    : [
        { to: "/app", label: t("nav.today"), icon: LayoutDashboard, end: true },
        { to: "/app/people", label: t("nav.people"), icon: Users },
        { to: "/app/schedule", label: t("nav.schedule"), icon: Calendar },
        { to: "/app/money", label: t("nav.money"), icon: Wallet },
        { to: "/app/inbox", label: t("nav.inbox"), icon: MessageSquare },
      ];

  const settingsPath = isStudent || isParent ? "/app/preferences" : "/app/settings";

  // Mobile bottom tab bar (REDESIGN §16): Today / Classes / Inbox / More,
  // Students and Money live behind More. Parents keep their short rail as
  // primary tabs with nothing content-wise left for More, but every role
  // still needs More for Settings/Log out since the rail's bottom section
  // is hidden on mobile.
  const mobileTabs = isStudent
    ? rail.filter((item) => ["/app", "/app/my-schedule", "/app/inbox"].includes(item.to))
    : isParent
    ? rail
    : rail.filter((item) => ["/app", "/app/schedule", "/app/inbox"].includes(item.to));

  const moreNavItems = rail.filter((item) => !mobileTabs.includes(item));

  return (
    <div className="flex h-screen bg-[var(--cs-bg)] font-sans">
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

      {/* Labelled rail (desktop/tablet only; bottom tab bar replaces it below md) */}
      <aside className="hidden w-[92px] flex-col items-center gap-0.5 border-r border-[var(--cs-border)] bg-[var(--cs-surface)] px-2 py-2.5 md:flex">
        <button
          onClick={() => navigate("/app")}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[8px] bg-[var(--cs-accent)] text-sm font-semibold text-[var(--cs-accent-contrast)]"
          title={t("common.appName")}
        >
          c
        </button>

        {/* Org-switcher slot: reserved for R2 (B-06/B-07), visual placeholder only */}
        <div
          className="mb-2 mt-1.5 flex h-[30px] w-full items-center justify-center rounded-[var(--cs-radius-control)] border border-dashed border-[var(--cs-border-strong)] text-[10px] text-[var(--cs-text-faint)]"
          aria-hidden="true"
        >
          org ▾
        </div>

        <nav className="flex flex-1 flex-col items-center gap-0.5">
          {rail.map((item) => (
            <NavLink key={item.to} to={item.to} end={(item as any).end} className={railClass}>
              <item.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex w-full flex-col items-center gap-0.5">
          {isPlatformAdmin && (
            <NavLink to="/app/platform-admin" className={railClass}>
              <ShieldAlert className="h-[18px] w-[18px]" strokeWidth={1.75} />
              <span>{t("common.platformAdmin")}</span>
            </NavLink>
          )}
          {(isStaff || isPlatformAdmin) && (
            <NavLink to="/app/audit-log" className={railClass}>
              <ClipboardList className="h-[18px] w-[18px]" strokeWidth={1.75} />
              <span>{t("common.auditLog")}</span>
            </NavLink>
          )}
          <NavLink to={settingsPath} className={railClass}>
            <Settings className="h-[18px] w-[18px]" strokeWidth={1.75} />
            <span>{t("common.settings")}</span>
          </NavLink>
          <button onClick={handleLogout} className={`${RAIL_ITEM} ${RAIL_OFF}`}>
            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.75} />
            <span>{t("common.logOut")}</span>
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-between border-b border-[var(--cs-border)] bg-[var(--cs-surface)] px-4">
          {/* Real palette trigger where the fake search box used to be */}
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex w-72 items-center gap-2 rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] bg-[var(--cs-bg)] px-3 py-1.5 text-sm text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:border-[var(--cs-accent)]"
          >
            <Search className="h-4 w-4" strokeWidth={1.75} />
            <span className="flex-1 text-left">{t("common.search")}</span>
            <kbd className="rounded-[4px] border border-[var(--cs-border)] bg-[var(--cs-surface)] px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/app/inbox?segment=unread")}
              className="relative flex h-9 w-9 items-center justify-center rounded-[var(--cs-radius-control)] text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)] hover:text-[var(--cs-text)]"
              title={t("common.notifications")}
            >
              <Bell className="h-[18px] w-[18px]" strokeWidth={1.75} />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--cs-danger)]" />
              )}
            </button>

            <div className="relative flex items-center" ref={dropdownRef}>
              <button
                onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                className="flex items-center gap-2 rounded-[var(--cs-radius-control)] px-2 py-1 transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-focus)]"
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
                <div className="absolute right-0 top-full z-10 mt-2 w-48 rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-1 shadow-[var(--cs-shadow-pop)]">
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
                      className={`w-full px-4 py-2 text-left text-sm capitalize transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${
                        currentRole === role
                          ? "bg-[var(--cs-accent-soft)] font-medium text-[var(--cs-accent)]"
                          : "text-[var(--cs-text)] hover:bg-[var(--cs-surface-2)]"
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

        <main className="flex-1 overflow-y-auto px-6 pb-24 pt-6 md:pb-6">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Bottom tab bar (mobile only) */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--cs-border)] bg-[var(--cs-surface)] pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label={t("common.navigation")}
      >
        {mobileTabs.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={(item as any).end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${
                isActive ? "text-[var(--cs-accent)]" : "text-[var(--cs-text-muted)]"
              }`
            }
          >
            <item.icon className="h-5 w-5" strokeWidth={1.75} />
            {item.label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${
            moreNavItems.some((item) => location.pathname === item.to) || location.pathname === settingsPath
              ? "text-[var(--cs-accent)]"
              : "text-[var(--cs-text-muted)]"
          }`}
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} />
          {t("common.more")}
        </button>
      </nav>

      {moreOpen && (
        <BottomSheet onClose={() => setMoreOpen(false)} label={t("common.more")}>
          <div className="flex flex-col gap-1 px-2 pb-4">
            {moreNavItems.map((item) => (
              <button
                key={item.to}
                onClick={() => {
                  navigate(item.to);
                  setMoreOpen(false);
                }}
                className="flex items-center gap-3 rounded-[var(--cs-radius-control)] px-3 py-2.5 text-left text-sm text-[var(--cs-text)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]"
              >
                <item.icon className="h-[18px] w-[18px] text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                {item.label}
              </button>
            ))}
            {isPlatformAdmin && (
              <button
                onClick={() => {
                  navigate("/app/platform-admin");
                  setMoreOpen(false);
                }}
                className="flex items-center gap-3 rounded-[var(--cs-radius-control)] px-3 py-2.5 text-left text-sm text-[var(--cs-text)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]"
              >
                <ShieldAlert className="h-[18px] w-[18px] text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                {t("common.platformAdmin")}
              </button>
            )}
            {(isStaff || isPlatformAdmin) && (
              <button
                onClick={() => {
                  navigate("/app/audit-log");
                  setMoreOpen(false);
                }}
                className="flex items-center gap-3 rounded-[var(--cs-radius-control)] px-3 py-2.5 text-left text-sm text-[var(--cs-text)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]"
              >
                <ClipboardList className="h-[18px] w-[18px] text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                {t("common.auditLog")}
              </button>
            )}
            <button
              onClick={() => {
                navigate(settingsPath);
                setMoreOpen(false);
              }}
              className="flex items-center gap-3 rounded-[var(--cs-radius-control)] px-3 py-2.5 text-left text-sm text-[var(--cs-text)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]"
            >
              <Settings className="h-[18px] w-[18px] text-[var(--cs-text-muted)]" strokeWidth={1.75} />
              {t("common.settings")}
            </button>
            <div className="my-1 border-t border-[var(--cs-border)]" />
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 rounded-[var(--cs-radius-control)] px-3 py-2.5 text-left text-sm text-[var(--cs-text)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]"
            >
              <LogOut className="h-[18px] w-[18px] text-[var(--cs-text-muted)]" strokeWidth={1.75} />
              {t("common.logOut")}
            </button>
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
