import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "../supabase";
import { resolveActiveOrganizationId, type OrganizationMembership } from "../../shared/activeOrganization";

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
  // The real authorization tier, from organization_members.role — distinct
  // from role_type/role above, which is a person-type (tutor/parent/student)
  // display preference, not an authorization boundary. Admin-tier UI must
  // gate on this field, not role_type.
  organizationRole?: 'owner' | 'admin' | 'tutor' | 'frontdesk' | 'accountant' | 'parent' | 'student' | null;
  // Every org this person belongs to (B-06c, EXECUTION_PLAN.md Step 17),
  // ordered earliest-first — a person can now hold more than one membership
  // (Step 16). `organizationId`/`organizationRole` above always mirror
  // whichever entry here is currently active. No switcher UI consumes this
  // yet (that's B-07) — it exists so the API layer can send the active org
  // on every request instead of the server silently guessing.
  organizations?: OrganizationMembership[];
}

interface AuthContextType {
  user: User | null;
  currentRole: string | null;
  setCurrentRole: (role: string | null) => void;
  // The org the client is currently acting in, sent as the X-Organization-Id
  // header on every api() call (src/lib/api.ts). Persisted the same way
  // currentRole is; no switcher UI writes this yet (B-07), but exposing the
  // setter now means B-07 doesn't need any AuthContext changes to land.
  activeOrganizationId: string | null;
  setActiveOrganizationId: (organizationId: string | null) => void;
  loading: boolean;
  login: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (email: string, password: string, name: string) => Promise<void>;
  sendOTP: (phoneNumber: string) => Promise<void>;
  verifyOTP: (phoneNumber: string, otp: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [currentRole, setCurrentRoleState] = useState<string | null>(() => {
    return localStorage.getItem('currentRole');
  });
  const [activeOrganizationId, setActiveOrganizationIdState] = useState<string | null>(() => {
    return localStorage.getItem('activeOrganizationId');
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

  const setActiveOrganizationId = (organizationId: string | null) => {
    setActiveOrganizationIdState(organizationId);
    if (organizationId) {
      localStorage.setItem('activeOrganizationId', organizationId);
    } else {
      localStorage.removeItem('activeOrganizationId');
    }
  };

  const loadUser = async (authUserId: string, authEmail: string | undefined, authUserMetadata?: Record<string, unknown>): Promise<User | null> => {
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
          return null;
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
        // The Full Name typed at signup lives in GoTrue's user_metadata (set
        // via signUp's options.data), not on the profiles row yet — read it
        // back here or every self-registered account gets a blank name.
        const metadataName = (authUserMetadata?.name || authUserMetadata?.full_name) as string | undefined;
        currentUserData = {
          id: authUserId,
          name: metadataName || "",
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
      //
      // B-06c (EXECUTION_PLAN.md Step 17): a person can now hold more than
      // one membership (Step 16), so this fetches the *full* list via the
      // server (GET /me/organizations — a direct client-side Supabase query
      // can't see which one the server would pick without a switcher's
      // input) instead of just the earliest row, and resolves + persists
      // which one is "active" the same way currentRole already is.
      try {
        const { data: { session: freshSession } } = await supabase.auth.getSession();
        const token = freshSession?.access_token;
        let organizations: OrganizationMembership[] = [];

        if (token) {
          const resp = await fetch('/api/v1/members/me/organizations', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (resp.ok) {
            const body = await resp.json();
            organizations = (body.organizations ?? []) as OrganizationMembership[];
          }
        }

        if (organizations.length === 0 && (currentUserData.role_type === 'tutor' || currentUserData.role === 'admin')) {
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
            // Bootstrap always creates the caller as owner (server/routes/members.ts).
            organizations = [{ organizationId: body.organizationId, organizationName: null, role: "owner" }];
          }
        }

        currentUserData.organizations = organizations;

        const resolvedActiveOrgId = resolveActiveOrganizationId(localStorage.getItem('activeOrganizationId'), organizations);
        setActiveOrganizationId(resolvedActiveOrgId);

        const activeOrg = organizations.find((org) => org.organizationId === resolvedActiveOrgId);
        if (activeOrg) {
          currentUserData.organizationId = activeOrg.organizationId;
          currentUserData.organizationRole = activeOrg.role as User["organizationRole"];
        }
      } catch (error) {
        console.error("Failed to resolve organization membership", error);
      }

      setUser(currentUserData);
      return currentUserData;
    } catch (error) {
      handleSupabaseError(error, OperationType.GET, "profiles", authUserId, authEmail);
      setUser(null);
      return null;
    }
  };

  // Returns the freshly-resolved user (including organizationId) rather than
  // just triggering a side effect — callers that need to act on a just-set
  // organizationId (e.g. onboarding writing a role profile right after
  // bootstrap) must use this return value, not a stale `user` closure, since
  // a React state update from setUser() inside loadUser() isn't visible to
  // the caller's own variables until a re-render happens.
  const checkAuth = async (): Promise<User | null> => {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (currentSession?.user) {
      return await loadUser(currentSession.user.id, currentSession.user.email, currentSession.user.user_metadata);
    }
    return null;
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (newSession?.user) {
        await loadUser(newSession.user.id, newSession.user.email, newSession.user.user_metadata);
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
    // Deliberately does not insert the profiles row itself: right after
    // signUp(), if the project requires email confirmation, there is no
    // active session yet (auth.uid() is null), so an insert here would
    // always fail RLS's `id = auth.uid()` check with a 401 — even though
    // signup succeeded. loadUser() (wired to onAuthStateChange above)
    // creates the profile once a real session exists, whether that's
    // immediately (confirmation disabled) or after the user clicks the
    // confirmation link (confirmation enabled).
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
    });
    if (error) throw error;
    if (data.user && !data.session) {
      throw new Error("Check your email to confirm your account before signing in.");
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
      setActiveOrganizationId(null);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, currentRole, setCurrentRole, activeOrganizationId, setActiveOrganizationId, loading, login, loginWithEmail, registerWithEmail, sendOTP, verifyOTP, logout, checkAuth }}>
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
