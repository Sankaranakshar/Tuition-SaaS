import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "../supabase";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface SupabaseErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | undefined;
  }
}

function handleSupabaseError(error: unknown, operationType: OperationType, path: string | null, userId?: string, email?: string) {
  const errInfo: SupabaseErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: { userId, email },
    operationType,
    path
  }
  console.error('Supabase Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

interface User {
  id: string; // Supabase auth.users id
  name: string;
  email: string;
  phone_number?: string;
  role_type: 'tutor' | 'parent' | 'student' | 'admin' | null;
  role: 'tutor' | 'parent' | 'student' | 'admin' | null; // Alias for backward compatibility
  roles?: string[]; // Array of roles the user has
  profile_status: 'incomplete' | 'complete';
  is_active: boolean;
  timezone?: string;
  organizationId?: string;
}

interface AuthContextType {
  user: User | null;
  currentRole: string | null;
  setCurrentRole: (role: string | null) => void;
  loading: boolean;
  login: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, name: string) => Promise<void>;
  sendOTP: (phoneNumber: string) => Promise<void>;
  verifyOTP: (phoneNumber: string, otp: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [currentRole, setCurrentRoleState] = useState<string | null>(() => {
    return localStorage.getItem('currentRole');
  });
  const [loading, setLoading] = useState(true);

  const setCurrentRole = (role: string | null) => {
    setCurrentRoleState(role);
    if (role) {
      localStorage.setItem('currentRole', role);
    } else {
      localStorage.removeItem('currentRole');
    }
  };

  const loadUser = async (authUserId: string, authEmail: string | undefined) => {
    try {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", authUserId)
        .maybeSingle();
      if (error) throw error;

      let currentUserData: User;

      if (profile) {
        if (profile.is_active === false) {
          await supabase.auth.signOut();
          setUser(null);
          setLoading(false);
          return;
        }
        currentUserData = {
          id: authUserId,
          name: profile.name || "",
          email: profile.email || authEmail || "",
          phone_number: profile.phone || "",
          role_type: profile.role_type ?? null,
          role: profile.role_type ?? null,
          roles: profile.roles && profile.roles.length ? profile.roles : (profile.role_type ? [profile.role_type] : []),
          profile_status: profile.profile_status || 'incomplete',
          is_active: profile.is_active !== undefined ? profile.is_active : true,
        };
      } else {
        // Create a new profile row if it doesn't exist. Authorization-bearing
        // fields (organization membership/role) are never written here — that
        // comes exclusively from the organization_members table via the server.
        currentUserData = {
          id: authUserId,
          name: "",
          email: authEmail || "",
          phone_number: "",
          role_type: null,
          role: null,
          roles: [],
          profile_status: 'incomplete',
          is_active: true,
        };
        const { error: insertErr } = await supabase.from("profiles").insert({
          id: authUserId,
          name: currentUserData.name,
          email: currentUserData.email,
          phone: currentUserData.phone_number,
          role_type: null,
          profile_status: 'incomplete',
          is_active: true,
        });
        if (insertErr) throw insertErr;
      }

      // Automatically set current role if user only has one role and no current role is set
      if (currentUserData.roles && currentUserData.roles.length === 1 && !localStorage.getItem('currentRole')) {
        setCurrentRole(currentUserData.roles[0]);
      } else if (currentUserData.roles && currentUserData.roles.length > 0 && localStorage.getItem('currentRole')) {
        if (!currentUserData.roles.includes(localStorage.getItem('currentRole')!)) {
          setCurrentRole(currentUserData.roles[0]);
        }
      }

      // Organization identity comes from the organization_members table,
      // which only the server writes to (POST /api/v1/members/bootstrap
      // creates the org, the owner membership row, atomically). Unlike the
      // old Firebase-custom-claims model, there's no token refresh needed
      // here — RLS reads organization_members fresh on every query.
      try {
        const { data: membership } = await supabase
          .from("organization_members")
          .select("organization_id")
          .eq("user_id", authUserId)
          .limit(1)
          .maybeSingle();

        if (!membership && (currentUserData.role_type === 'tutor' || currentUserData.role === 'admin')) {
          const { data: { session: freshSession } } = await supabase.auth.getSession();
          const token = freshSession?.access_token;
          const resp = await fetch('/api/v1/members/bootstrap', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ organizationName: `${currentUserData.name || currentUserData.email}'s Tutoring` }),
          });
          if (resp.ok) {
            const body = await resp.json();
            currentUserData.organizationId = body.organizationId;
          }
        } else if (membership) {
          currentUserData.organizationId = membership.organization_id as string;
        }
      } catch (error) {
        console.error("Failed to resolve organization membership", error);
      }

      setUser(currentUserData);
    } catch (error) {
      handleSupabaseError(error, OperationType.GET, "profiles", authUserId, authEmail);
      setUser(null);
    }
  };

  const checkAuth = async () => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (currentSession?.user) {
      await loadUser(currentSession.user.id, currentSession.user.email);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (newSession?.user) {
        await loadUser(newSession.user.id, newSession.user.email);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async () => {
    try {
      // Note: unlike Firebase's signInWithPopup, Supabase's OAuth flow
      // redirects the whole page to the provider and back (redirectTo
      // defaults to the current origin) rather than opening a popup.
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
      if (error) throw error;
    } catch (error) {
      console.error("Login failed", error);
      throw error;
    }
  };

  const loginWithEmail = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const registerWithEmail = async (email: string, password: string, name: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name } },
      });
      if (error) throw error;
      if (!data.user) return;

      const { error: insertErr } = await supabase.from("profiles").insert({
        id: data.user.id,
        name,
        email,
        phone: "",
        role_type: null,
        profile_status: 'incomplete',
        is_active: true,
      });
      if (insertErr) throw insertErr;
    } catch (error) {
      handleSupabaseError(error, OperationType.CREATE, "profiles");
    }
  };

  // Self-hosted GoTrue's phone OTP (Twilio-backed) doesn't need a client-side
  // reCAPTCHA widget the way Firebase phone auth did — sendOTP/verifyOTP take
  // just the phone number now.
  const sendOTP = async (phoneNumber: string) => {
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: phoneNumber });
      if (error) throw error;
    } catch (error) {
      console.error("Error sending OTP:", error);
      throw error;
    }
  };

  const verifyOTP = async (phoneNumber: string, otp: string) => {
    try {
      const { error } = await supabase.auth.verifyOtp({ phone: phoneNumber, token: otp, type: 'sms' });
      if (error) throw error;
      // onAuthStateChange handles the rest
    } catch (error) {
      console.error("Error verifying OTP:", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setCurrentRole(null);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, currentRole, setCurrentRole, loading, login, loginWithEmail, registerWithEmail, sendOTP, verifyOTP, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
