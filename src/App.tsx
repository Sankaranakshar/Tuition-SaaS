import React, { Suspense, lazy } from "react";
import { Toaster } from "sonner";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Layout from "./components/Layout";
import PublicLayout from "./components/PublicLayout";

// Eagerly load critical pages
import Login from "./pages/Login";
import Onboarding from "./pages/Onboarding";
import RoleSelection from "./pages/RoleSelection";
import Home from "./pages/public/Home";

// Lazy load public pages
const Features = lazy(() => import("./pages/public/Features"));
const Pricing = lazy(() => import("./pages/public/Pricing"));
const HowItWorks = lazy(() => import("./pages/public/HowItWorks"));

// Lazy load protected app pages
const Today = lazy(() => import("./pages/Today"));
const People = lazy(() => import("./pages/People"));
const StudentStory = lazy(() => import("./pages/StudentStory"));
const Schedule = lazy(() => import("./pages/Schedule"));
const Courses = lazy(() => import("./pages/Courses"));
const Documents = lazy(() => import("./pages/Documents"));
const Money = lazy(() => import("./pages/Money"));
const Settings = lazy(() => import("./pages/Settings"));
const Inbox = lazy(() => import("./pages/Inbox"));
const Kit = lazy(() => import("./pages/Kit"));
const PlatformAdmin = lazy(() => import("./pages/PlatformAdmin"));

// Lazy load student pages
const Profile = lazy(() => import("./pages/Profile"));
const Preferences = lazy(() => import("./pages/Preferences"));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, currentRole, loading } = useAuth();
  const location = useLocation();
  
  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  
  if (user.profile_status === 'incomplete' && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" />;
  }
  
  if (user.profile_status === 'complete' && location.pathname === '/onboarding') {
    return <Navigate to="/app" />;
  }

  if (user.profile_status === 'complete' && user.roles && user.roles.length > 1 && !currentRole && location.pathname !== '/role-selection') {
    return <Navigate to="/role-selection" />;
  }

  if (currentRole && location.pathname === '/role-selection') {
    return <Navigate to="/app" />;
  }
  
  return <>{children}</>;
}

const LoadingFallback = () => (
  <div className="flex h-screen items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
  </div>
);

// A logged-out parent opening /onboarding?invite=TOKEN gets bounced through
// /login → /app before landing on /onboarding, and none of those redirects
// preserve the query string. Stash the token once, up front, so Onboarding
// can recover it after the hop (see src/pages/Onboarding.tsx).
function capturePendingParentInvite() {
  const token = new URLSearchParams(window.location.search).get("invite");
  if (token) sessionStorage.setItem("pendingParentInvite", token);
}
capturePendingParentInvite();

// Same deep-link problem as the parent invite above (Tech Debt #16): a
// logged-out student opening /onboarding?studentInvite=TOKEN gets bounced
// through /login → /app before landing on /onboarding, dropping the query
// string along the way.
function capturePendingStudentInvite() {
  const token = new URLSearchParams(window.location.search).get("studentInvite");
  if (token) sessionStorage.setItem("pendingStudentInvite", token);
}
capturePendingStudentInvite();

export default function App() {
  return (
    <AuthProvider>
      <Toaster position="bottom-right" richColors closeButton />
      <Router>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            {/* Public Routes */}
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/features" element={<Features />} />
              <Route path="/pricing" element={<Pricing />} />
              <Route path="/how-it-works" element={<HowItWorks />} />
            </Route>

            <Route path="/login" element={<Login />} />
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
            <Route path="/role-selection" element={<ProtectedRoute><RoleSelection /></ProtectedRoute>} />
            
            {/* Protected App Routes */}
            <Route path="/app" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Today />} />
              <Route path="people" element={<People />} />
              <Route path="students/:id" element={<StudentStory />} />
              <Route path="schedule" element={<Schedule />} />
              <Route path="calendar" element={<Navigate to="/app/schedule" replace />} />
              <Route path="courses" element={<Courses />} />
              <Route path="documents" element={<Documents />} />
              <Route path="money" element={<Money />} />
              <Route path="inbox" element={<Inbox />} />
              <Route path="messaging" element={<Navigate to="/app/inbox" replace />} />
              <Route path="notifications" element={<Navigate to="/app/inbox" replace />} />
              <Route path="settings" element={<Settings />} />
              <Route path="kit" element={<Kit />} />
              <Route path="platform-admin" element={<PlatformAdmin />} />

              {/* Student Routes */}
              <Route path="my-story" element={<StudentStory />} />
              <Route path="my-schedule" element={<Schedule />} />
              <Route path="timetable" element={<Navigate to="/app/my-schedule" replace />} />
              <Route path="bookings" element={<Navigate to="/app/schedule" replace />} />
              <Route path="profile" element={<Profile />} />
              <Route path="preferences" element={<Preferences />} />
            </Route>
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}

