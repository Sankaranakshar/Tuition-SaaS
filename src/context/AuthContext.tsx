import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { onAuthStateChanged, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, RecaptchaVerifier, signInWithPhoneNumber, ConfirmationResult } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "../firebase";

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

declare global {
  interface Window {
    recaptchaVerifier: any;
  }
}

interface User {
  id: string; // Firebase UID
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
  sendOTP: (phoneNumber: string, containerId: string) => Promise<ConfirmationResult>;
  verifyOTP: (confirmationResult: ConfirmationResult, otp: string) => Promise<void>;
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

  const checkAuth = async () => {
    if (auth.currentUser) {
      try {
        const userDocRef = doc(db, "users", auth.currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUser(prev => ({
            ...(prev || { id: auth.currentUser!.uid, name: data.name || "", email: data.email || "", profile_status: 'incomplete', is_active: true }),
            ...data,
            role: data.role_type || data.role || null,
            role_type: data.role_type || data.role || null,
            profile_status: data.profile_status || 'incomplete',
            is_active: data.is_active !== undefined ? data.is_active : true,
          }) as User);
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, "users");
      }
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          // Fetch user document from Firestore
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);
          
          let currentUserData: User;

          if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.is_active === false) {
              await signOut(auth);
              setUser(null);
              setLoading(false);
              return;
            }
            currentUserData = { 
              id: firebaseUser.uid, 
              ...data,
              role: data.role_type || data.role || null, // Fallback for old data
              role_type: data.role_type || data.role || null,
              roles: data.roles || (data.role_type ? [data.role_type] : []),
              profile_status: data.profile_status || 'incomplete',
              is_active: data.is_active !== undefined ? data.is_active : true,
            } as User;
          } else {
            // Create a new user document if it doesn't exist
            currentUserData = {
              id: firebaseUser.uid,
              name: firebaseUser.displayName || "Unknown User",
              email: firebaseUser.email || "",
              phone_number: firebaseUser.phoneNumber || "",
              role_type: null,
              role: null,
              roles: [],
              profile_status: 'incomplete',
              is_active: true,
            };
            // Authorization-bearing fields (role, roles, organizationId) are
            // never written client-side; membership comes from the server.
            await setDoc(userDocRef, {
              uid: currentUserData.id,
              name: currentUserData.name,
              email: currentUserData.email,
              phone_number: currentUserData.phone_number,
              role_type: currentUserData.role_type,
              profile_status: currentUserData.profile_status,
              created_at: new Date().toISOString(),
              is_active: currentUserData.is_active
            });
          }

          // Automatically set current role if user only has one role and no current role is set
          if (currentUserData.roles && currentUserData.roles.length === 1 && !localStorage.getItem('currentRole')) {
            setCurrentRole(currentUserData.roles[0]);
          } else if (currentUserData.roles && currentUserData.roles.length > 0 && localStorage.getItem('currentRole')) {
            // Ensure the stored role is still valid
            if (!currentUserData.roles.includes(localStorage.getItem('currentRole')!)) {
              setCurrentRole(currentUserData.roles[0]);
            }
          }

          // Organization identity comes from custom claims, which only the
          // server can set (POST /api/v1/members/bootstrap creates the org,
          // the owner membership, and the claims atomically).
          try {
            let claims = (await firebaseUser.getIdTokenResult()).claims;

            if (!claims.organizationId && (currentUserData.role_type === 'tutor' || currentUserData.role === 'admin')) {
              const token = await firebaseUser.getIdToken();
              const resp = await fetch('/api/v1/members/bootstrap', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ organizationName: `${currentUserData.name}'s Tutoring` }),
              });
              if (resp.ok || resp.status === 409) {
                // Claims changed server-side; force a token refresh to load them.
                claims = (await firebaseUser.getIdTokenResult(true)).claims;
              }
            }

            if (claims.organizationId) {
              currentUserData.organizationId = claims.organizationId as string;
            }
          } catch (error) {
            console.error("Failed to resolve organization membership", error);
          }

          setUser(currentUserData);
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, "users");
          setUser(null);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
      throw error;
    }
  };

  const loginWithEmail = async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      throw error;
    }
  };

  const registerWithEmail = async (email: string, password: string, name: string) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      
      // Update the user's profile with their name
      await updateProfile(userCredential.user, {
        displayName: name
      });
      
      const userDocRef = doc(db, "users", userCredential.user.uid);
      await setDoc(userDocRef, {
        uid: userCredential.user.uid,
        name: name,
        email: email,
        phone_number: "",
        role_type: null,
        profile_status: 'incomplete',
        created_at: new Date().toISOString(),
        is_active: true
      });
      
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "users");
    }
  };

  const setupRecaptcha = (containerId: string) => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, containerId, {
        size: 'invisible',
      });
    }
  };

  const sendOTP = async (phoneNumber: string, containerId: string): Promise<ConfirmationResult> => {
    try {
      setupRecaptcha(containerId);
      const appVerifier = window.recaptchaVerifier;
      return await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
    } catch (error) {
      console.error("Error sending OTP:", error);
      throw error;
    }
  };

  const verifyOTP = async (confirmationResult: ConfirmationResult, otp: string) => {
    try {
      await confirmationResult.confirm(otp);
      // onAuthStateChanged will handle the rest
    } catch (error) {
      console.error("Error verifying OTP:", error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
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
