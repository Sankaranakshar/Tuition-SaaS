import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { GraduationCap, Mail, Lock, User as UserIcon, Phone, ArrowLeft } from "lucide-react";
import { Button, Field, Input } from "../components/kit";

const ICON_INPUT_CLASS = "pl-10";
const ICON_CLASS = "pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--cs-text-faint)]";

export default function Login() {
  const { login, loginWithEmail, registerWithEmail, sendOTP, verifyOTP, user } = useAuth();
  const navigate = useNavigate();

  const [isLogin, setIsLogin] = useState(true);
  const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('phone');

  // Email state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  // Phone state
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    if (user) {
      navigate("/app");
    }
  }, [user, navigate]);

  const handleGoogleLogin = async () => {
    try {
      setError("");
      await login();
    } catch (err: any) {
      setError(err.message || "Failed to sign in with Google");
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isLogin) {
        await loginWithEmail(email, password);
      } else {
        await registerWithEmail(email, password, name);
      }
    } catch (err: any) {
      const message: string = err.message || "";
      if (message.toLowerCase().includes("invalid login credentials")) {
        setError("Invalid email or password. Please check your credentials or sign up if you don't have an account.");
      } else if (message.toLowerCase().includes("user already registered")) {
        setError("An account with this email already exists. Please sign in instead.");
      } else {
        setError(message || `Failed to ${isLogin ? 'sign in' : 'register'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;
      await sendOTP(formattedPhone);
      setOtpSentTo(formattedPhone);
    } catch (err: any) {
      setError(err.message || "Failed to send OTP. Ensure phone number includes country code (e.g., +1234567890).");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpSentTo) return;
    setError("");
    setLoading(true);
    try {
      await verifyOTP(otpSentTo, otp);
    } catch (err: any) {
      setError(err.message || "Invalid OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col justify-center bg-[var(--cs-bg)] px-4 py-12 sm:px-6 lg:px-8">
      <button
        onClick={() => navigate('/')}
        className="absolute left-8 top-8 flex items-center text-sm text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-text)]"
      >
        <ArrowLeft className="mr-2 h-4 w-4" strokeWidth={1.75} />
        Back to Home
      </button>

      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-[var(--cs-radius-container)] bg-[var(--cs-accent)]">
            <GraduationCap className="h-7 w-7 text-[var(--cs-accent-contrast)]" strokeWidth={1.75} />
          </div>
        </div>
        <h2 className="mt-6 text-center text-[20px] font-semibold tracking-[-0.01em] text-[var(--cs-text)]">
          {isLogin ? "Sign in to classstackr" : "Create an account"}
        </h2>
        <p className="mt-2 text-center text-sm text-[var(--cs-text-muted)]">
          The complete tuition management platform
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] px-4 py-8 sm:px-10">
          {error && (
            <div className="mb-4 rounded-[var(--cs-radius-control)] bg-[var(--cs-danger-soft)] px-4 py-3 text-sm text-[var(--cs-danger)]">
              {error}
            </div>
          )}

          <div className="mb-6 flex justify-center space-x-4">
            <button
              onClick={() => { setAuthMethod('phone'); setError(""); setOtpSentTo(null); }}
              className={`border-b-2 px-4 pb-2 text-sm font-medium transition-colors duration-[var(--cs-motion-fast)] ${authMethod === 'phone' ? 'border-[var(--cs-accent)] text-[var(--cs-accent)]' : 'border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text)]'}`}
            >
              Phone
            </button>
            <button
              onClick={() => { setAuthMethod('email'); setError(""); }}
              className={`border-b-2 px-4 pb-2 text-sm font-medium transition-colors duration-[var(--cs-motion-fast)] ${authMethod === 'email' ? 'border-[var(--cs-accent)] text-[var(--cs-accent)]' : 'border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text)]'}`}
            >
              Email
            </button>
          </div>

          {authMethod === 'email' ? (
            <form className="space-y-6" onSubmit={handleEmailAuth}>
              {!isLogin && (
                <Field
                  label="Full name"
                  renderControl={(id) => (
                    <div className="relative">
                      <span className={ICON_CLASS}><UserIcon className="h-4 w-4" strokeWidth={1.75} /></span>
                      <Input id={id} type="text" required value={name} onChange={(e) => setName(e.target.value)} className={ICON_INPUT_CLASS} placeholder="John Doe" />
                    </div>
                  )}
                />
              )}

              <Field
                label="Email address"
                renderControl={(id) => (
                  <div className="relative">
                    <span className={ICON_CLASS}><Mail className="h-4 w-4" strokeWidth={1.75} /></span>
                    <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={ICON_INPUT_CLASS} placeholder="you@example.com" />
                  </div>
                )}
              />

              <Field
                label="Password"
                renderControl={(id) => (
                  <div className="relative">
                    <span className={ICON_CLASS}><Lock className="h-4 w-4" strokeWidth={1.75} /></span>
                    <Input id={id} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={ICON_INPUT_CLASS} placeholder="••••••••" />
                  </div>
                )}
              />

              <Button type="submit" disabled={loading} className="w-full">
                {loading ? "Please wait…" : (isLogin ? "Sign in" : "Sign up")}
              </Button>
            </form>
          ) : (
            <div className="space-y-6">
              {!otpSentTo ? (
                <form onSubmit={handleSendOTP} className="space-y-6">
                  <Field
                    label="Phone number"
                    renderControl={(id) => (
                      <div className="relative">
                        <span className={ICON_CLASS}><Phone className="h-4 w-4" strokeWidth={1.75} /></span>
                        <Input id={id} type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} className={ICON_INPUT_CLASS} placeholder="+1234567890" />
                      </div>
                    )}
                  />
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Sending OTP…" : "Send OTP"}
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleVerifyOTP} className="space-y-6">
                  <Field
                    label="Enter OTP"
                    renderControl={(id) => (
                      <div className="relative">
                        <span className={ICON_CLASS}><Lock className="h-4 w-4" strokeWidth={1.75} /></span>
                        <Input id={id} type="text" required value={otp} onChange={(e) => setOtp(e.target.value)} className={ICON_INPUT_CLASS} placeholder="123456" />
                      </div>
                    )}
                  />
                  <Button type="submit" disabled={loading} className="w-full">
                    {loading ? "Verifying…" : "Verify OTP"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setOtpSentTo(null)}
                    className="w-full text-sm text-[var(--cs-accent)] hover:text-[var(--cs-accent-hover)]"
                  >
                    Use a different number
                  </button>
                </form>
              )}
            </div>
          )}

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[var(--cs-border)]" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-[var(--cs-surface)] px-2 text-[var(--cs-text-muted)]">
                  Or continue with
                </span>
              </div>
            </div>

            <div className="mt-6">
              <Button variant="ghost" onClick={handleGoogleLogin} className="w-full">
                <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Google
              </Button>
            </div>
          </div>

          {authMethod === 'email' && (
            <div className="mt-6 text-center">
              <button
                onClick={() => {
                  setIsLogin(!isLogin);
                  setError("");
                }}
                className="text-sm font-medium text-[var(--cs-accent)] hover:text-[var(--cs-accent-hover)]"
              >
                {isLogin
                  ? "Don't have an account? Sign up"
                  : "Already have an account? Sign in"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
