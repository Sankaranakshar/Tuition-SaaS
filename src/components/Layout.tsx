import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { 
  LayoutDashboard, 
  Users, 
  UserPlus,
  Calendar, 
  FileText, 
  Receipt, 
  Settings, 
  LogOut,
  Bell,
  Search,
  MessageSquare,
  Shield,
  GraduationCap,
  Wallet,
  BookOpen,
  TrendingUp,
  Plus,
  ChevronDown
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

export default function Layout() {
  const { user, logout, currentRole, setCurrentRole } = useAuth();
  const navigate = useNavigate();
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
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

  const isStudent = currentRole === 'student';

  const tutorMainMenu = [
    { to: "/app", label: "Dashboard", icon: LayoutDashboard },
    { to: "/app/students", label: "Students", icon: Users },
    { to: "/app/calendar", label: "Calendar", icon: Calendar },
    { to: "/app/invoices", label: "Finances", icon: Wallet },
    { to: "/app/messaging", label: "Messaging", icon: MessageSquare },
    { to: "/app/leads", label: "Leads", icon: TrendingUp },
    { to: "/app/settings", label: "Settings", icon: Settings },
  ];

  const tutorLibraryMenu = [
    { to: "/app/documents", label: "Documents", icon: BookOpen },
  ];

  const studentMainMenu = [
    { to: "/app", label: "Dashboard", icon: LayoutDashboard },
    { to: "/app/notifications", label: "Notifications", icon: Bell },
    { to: "/app/academic-progress", label: "Academic Progress", icon: GraduationCap },
    { to: "/app/timetable", label: "Timetable", icon: Calendar },
    { to: "/app/bookings", label: "Bookings", icon: Calendar },
    { to: "/app/wallet", label: "Wallet", icon: Wallet },
    { to: "/app/transactions", label: "Transactions", icon: Receipt },
    { to: "/app/messaging", label: "Messaging", icon: MessageSquare },
    { to: "/app/profile", label: "Profile", icon: Settings },
    { to: "/app/preferences", label: "Preferences", icon: Settings },
  ];

  const studentLibraryMenu = [
    { to: "/app/study-material", label: "Study Material", icon: BookOpen },
  ];

  const mainMenu = isStudent ? studentMainMenu : tutorMainMenu;
  const libraryMenu = isStudent ? studentLibraryMenu : tutorLibraryMenu;

  if (currentRole === 'admin') {
    mainMenu.push({ to: "/app/admin", label: "Admin Panel", icon: Shield });
  }

  return (
    <div className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <h1 className="text-xl font-bold text-indigo-600">classstackr</h1>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-4">
          <div className="px-3 mb-8">
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Main Menu
            </div>
            <ul className="mt-2 space-y-1">
              {mainMenu.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `group flex items-center px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                        isActive
                          ? "bg-indigo-50 text-indigo-700 shadow-sm"
                          : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 hover:translate-x-1"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={`w-5 h-5 mr-3 transition-colors ${isActive ? 'text-indigo-600' : 'text-gray-400 group-hover:text-gray-600'}`} />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>

          <div className="px-3 mb-6">
            <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Library
            </div>
            <ul className="mt-2 space-y-1">
              {libraryMenu.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      `group flex items-center px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 ${
                        isActive
                          ? "bg-indigo-50 text-indigo-700 shadow-sm"
                          : "text-gray-700 hover:bg-gray-100 hover:text-gray-900 hover:translate-x-1"
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={`w-5 h-5 mr-3 transition-colors ${isActive ? 'text-indigo-600' : 'text-gray-400 group-hover:text-gray-600'}`} />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="p-4 border-t border-gray-200">
          <button
            onClick={handleLogout}
            className="flex items-center w-full px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 transition-colors"
          >
            <LogOut className="w-5 h-5 mr-3" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
          <div className="flex-1 flex items-center">
            <div className="relative w-64">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                <Search className="w-4 h-4 text-gray-400" />
              </span>
              <input
                type="text"
                placeholder="Search students, invoices..."
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <button 
              onClick={() => navigate('/app/students')}
              className="hidden md:flex items-center px-3 py-1.5 bg-indigo-50 text-indigo-600 text-sm font-medium rounded-md hover:bg-indigo-100 transition-colors"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Quick Add
            </button>
            <button className="text-gray-500 hover:text-gray-700 relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-0 right-0 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
            </button>
            <div className="flex items-center space-x-2 relative" ref={dropdownRef}>
              <button 
                onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                className="flex items-center space-x-2 focus:outline-none"
              >
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold">
                  {user?.name?.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col items-start">
                  <span className="text-sm font-medium text-gray-700 leading-tight">{user?.name}</span>
                  <span className="text-xs text-gray-500 capitalize">{currentRole} Portal</span>
                </div>
                {user?.roles && user.roles.length > 1 && (
                  <ChevronDown className="w-4 h-4 text-gray-400" />
                )}
              </button>

              {showRoleDropdown && user?.roles && user.roles.length > 1 && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-10 border border-gray-200">
                  <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                    Switch Portal
                  </div>
                  {user.roles.map((role) => (
                    <button
                      key={role}
                      onClick={() => {
                        setCurrentRole(role);
                        setShowRoleDropdown(false);
                        navigate('/app');
                      }}
                      className={`w-full text-left px-4 py-2 text-sm ${
                        currentRole === role 
                          ? 'bg-indigo-50 text-indigo-700 font-medium' 
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {role.charAt(0).toUpperCase() + role.slice(1)} Portal
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
