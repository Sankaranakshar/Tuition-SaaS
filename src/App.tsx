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
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Students = lazy(() => import("./pages/Students"));
const StudentProfile = lazy(() => import("./pages/StudentProfile"));
const Leads = lazy(() => import("./pages/Leads"));
const Calendar = lazy(() => import("./pages/Calendar"));
const Documents = lazy(() => import("./pages/Documents"));
const Invoices = lazy(() => import("./pages/Invoices"));
const Settings = lazy(() => import("./pages/Settings"));
const Messaging = lazy(() => import("./pages/Messaging"));
const Admin = lazy(() => import("./pages/Admin"));

// Lazy load student pages
const Notifications = lazy(() => import("./pages/Notifications"));
const AcademicProgress = lazy(() => import("./pages/AcademicProgress"));
const StudyMaterial = lazy(() => import("./pages/StudyMaterial"));
const Timetable = lazy(() => import("./pages/Timetable"));
const Bookings = lazy(() => import("./pages/Bookings"));
const Wallet = lazy(() => import("./pages/Wallet"));
const Transactions = lazy(() => import("./pages/Transactions"));
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
              <Route index element={<Dashboard />} />
              <Route path="students" element={<Students />} />
              <Route path="students/:id" element={<StudentProfile />} />
              <Route path="leads" element={<Leads />} />
              <Route path="calendar" element={<Calendar />} />
              <Route path="documents" element={<Documents />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="messaging" element={<Messaging />} />
              <Route path="settings" element={<Settings />} />
              <Route path="admin" element={<Admin />} />
              
              {/* Student Routes */}
              <Route path="notifications" element={<Notifications />} />
              <Route path="academic-progress" element={<AcademicProgress />} />
              <Route path="study-material" element={<StudyMaterial />} />
              <Route path="timetable" element={<Timetable />} />
              <Route path="bookings" element={<Bookings />} />
              <Route path="wallet" element={<Wallet />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="profile" element={<Profile />} />
              <Route path="preferences" element={<Preferences />} />
            </Route>
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}

