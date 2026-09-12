import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { Calendar, CheckCircle, AlertCircle, Settings as SettingsIcon, Building, Clock, User as UserIcon } from "lucide-react";
import { supabase } from "../supabase";
import { debounce } from "../lib/debounce";
import TutorAvailabilitySettings from "../components/TutorAvailabilitySettings";
import OrganizationSettings from "../components/OrganizationSettings";
import BillingInvoiceSettings from "../components/BillingInvoiceSettings";
import TutorProfileSettings from "../components/TutorProfileSettings";
import SubscriptionSettings from "../components/SubscriptionSettings";
import OrgExportSettings from "../components/OrgExportSettings";
import TeamSettings from "../components/TeamSettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Receipt, CreditCard, Database, Users } from "lucide-react";
import { StatusChip, Button } from "../components/kit";

export default function Settings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("google_calendar_connected")
        .eq("id", user.id)
        .single();
      if (!cancelled && !error) {
        setIsConnected(!!data?.google_calendar_connected);
      }
    };

    load();

    const debouncedLoad = debounce(load, 200);
    const channel = supabase
      .channel(`profile-google-calendar-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        debouncedLoad
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const handleConnectGoogle = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError("");
    try {
      const { supabase } = await import("../supabase");
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch('/api/v1/settings/google/url', {
        headers: {
          'Authorization': `Bearer ${token || ''}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to get auth URL');
      }
      
      const data = await response.json();
      
      // Open popup for OAuth
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;
      
      window.open(
        data.url,
        'Google OAuth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      // Listen for message from popup
      const handleMessage = async (event: MessageEvent) => {
        if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
          const { supabase } = await import("../supabase");
          await supabase
            .from("profiles")
            .update({ google_calendar_connected: true })
            .eq("id", user.id);
          setSuccess("Successfully connected to Google Calendar!");
          window.removeEventListener('message', handleMessage);
        }
      };
      
      window.addEventListener('message', handleMessage);
      
    } catch (err) {
      console.error(err);
      setError("Failed to initiate Google connection.");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { supabase } = await import("../supabase");
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const response = await fetch('/api/v1/settings/google/disconnect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token || ''}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to disconnect');
      }

      await supabase
        .from("profiles")
        .update({ google_calendar_connected: false })
        .eq("id", user.id);
      setSuccess("Disconnected from Google Calendar.");
    } catch (err) {
      setError("Failed to disconnect.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--cs-text)]">Settings</h1>

      <Tabs defaultValue="general" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="general" className="flex items-center">
            <SettingsIcon className="w-4 h-4 mr-2" />
            General
          </TabsTrigger>
          {(user?.role === "admin" || user?.role === "tutor") && (
            <TabsTrigger value="organization" className="flex items-center">
              <Building className="w-4 h-4 mr-2" />
              Organization
            </TabsTrigger>
          )}
          {(user?.organizationRole === "owner" || user?.organizationRole === "admin") && (
            <TabsTrigger value="team" className="flex items-center">
              <Users className="w-4 h-4 mr-2" />
              Team
            </TabsTrigger>
          )}
          {(user?.role === "admin" || user?.role === "tutor") && (
            <TabsTrigger value="billing" className="flex items-center">
              <Receipt className="w-4 h-4 mr-2" />
              Billing & Invoices
            </TabsTrigger>
          )}
          {(user?.role === "admin" || user?.role === "tutor") && (
            <TabsTrigger value="plan" className="flex items-center">
              <CreditCard className="w-4 h-4 mr-2" />
              Plan & Billing
            </TabsTrigger>
          )}
          {(user?.role === "admin" || user?.role === "tutor") && (
            <TabsTrigger value="availability" className="flex items-center">
              <Clock className="w-4 h-4 mr-2" />
              Availability
            </TabsTrigger>
          )}
          {(user?.role === "admin" || user?.role === "tutor") && (
            <TabsTrigger value="export" className="flex items-center">
              <Database className="w-4 h-4 mr-2" />
              Data & Offboarding
            </TabsTrigger>
          )}
          {(user?.role === "admin" || user?.role === "tutor") && (
            <TabsTrigger value="profile" className="flex items-center">
              <UserIcon className="w-4 h-4 mr-2" />
              Tutor Profile
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          {error && (
            <div className="flex items-center rounded-[var(--cs-radius-control)] bg-[var(--cs-danger-soft)] px-4 py-3 text-sm text-[var(--cs-danger)]">
              <AlertCircle className="mr-2 h-5 w-5" strokeWidth={1.75} />
              {error}
            </div>
          )}

          {success && (
            <div className="flex items-center rounded-[var(--cs-radius-control)] bg-[var(--cs-accent-soft)] px-4 py-3 text-sm text-[var(--cs-accent)]">
              <CheckCircle className="mr-2 h-5 w-5" strokeWidth={1.75} />
              {success}
            </div>
          )}

          <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
            <div className="border-b border-[var(--cs-border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--cs-text)]">Profile information</h2>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div>
                  <label htmlFor="profile-full-name" className="block text-sm font-medium text-[var(--cs-text-muted)]">Full name</label>
                  <input id="profile-full-name" type="text" disabled value={user?.name || ""} className="mt-1 block w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface-2)] px-3 py-1.5 text-[13px] text-[var(--cs-text-muted)]" />
                </div>
                <div>
                  <label htmlFor="profile-email" className="block text-sm font-medium text-[var(--cs-text-muted)]">Email address</label>
                  <input id="profile-email" type="email" disabled value={user?.email || ""} className="mt-1 block w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface-2)] px-3 py-1.5 text-[13px] text-[var(--cs-text-muted)]" />
                </div>
                <div>
                  <label htmlFor="profile-role" className="block text-sm font-medium text-[var(--cs-text-muted)]">Role</label>
                  <input id="profile-role" type="text" disabled value={user?.role || ""} className="mt-1 block w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface-2)] px-3 py-1.5 text-[13px] capitalize text-[var(--cs-text-muted)]" />
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
            <div className="border-b border-[var(--cs-border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--cs-text)]">Integrations</h2>
              <p className="mt-1 text-xs text-[var(--cs-text-muted)]">Connect third-party services to enhance your experience.</p>
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] p-4">
                <div className="flex items-center">
                  <div className="mr-4 rounded-[var(--cs-radius-control)] bg-[var(--cs-accent-soft)] p-2">
                    <Calendar className="h-6 w-6 text-[var(--cs-accent)]" strokeWidth={1.75} />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-[var(--cs-text)]">Google Calendar & Meet</h3>
                    <p className="text-sm text-[var(--cs-text-muted)]">Automatically generate Google Meet links for online classes.</p>
                  </div>
                </div>
                <div>
                  {isConnected ? (
                    <div className="flex items-center gap-4">
                      <StatusChip label="Connected" tone="positive" />
                      <button
                        onClick={handleDisconnectGoogle}
                        disabled={loading}
                        className="text-sm font-medium text-[var(--cs-danger)] hover:opacity-80"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <Button variant="ghost" onClick={handleConnectGoogle} disabled={loading}>
                      {loading ? "Connecting…" : "Connect Google"}
                    </Button>
                  )}
                </div>
              </div>

              {!isConnected && (
                <div className="mt-4 rounded-[var(--cs-radius-control)] bg-[var(--cs-surface-2)] p-4">
                  <h4 className="text-sm font-medium text-[var(--cs-text)]">Setup instructions for Google OAuth</h4>
                  <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-[var(--cs-text-muted)]">
                    <li>Go to Google Cloud Console and create an OAuth Client ID.</li>
                    <li>Add the following URL to your Authorized redirect URIs:</li>
                    <li className="mt-1 break-all rounded bg-[var(--cs-surface)] p-1 font-mono">
                      {window.location.origin}/api/v1/settings/google/callback
                    </li>
                    <li className="mt-2">Ensure you have <code className="rounded bg-[var(--cs-surface)] px-1">GOOGLE_CLIENT_ID</code> and <code className="rounded bg-[var(--cs-surface)] px-1">GOOGLE_CLIENT_SECRET</code> set in your environment variables.</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        {(user?.role === "admin" || user?.role === "tutor") && (
          <TabsContent value="organization">
            <OrganizationSettings />
          </TabsContent>
        )}

        {(user?.organizationRole === "owner" || user?.organizationRole === "admin") && (
          <TabsContent value="team">
            <TeamSettings />
          </TabsContent>
        )}

        {(user?.role === "admin" || user?.role === "tutor") && (
          <TabsContent value="billing">
            <BillingInvoiceSettings />
          </TabsContent>
        )}

        {(user?.role === "admin" || user?.role === "tutor") && (
          <TabsContent value="plan">
            <SubscriptionSettings />
          </TabsContent>
        )}

        {(user?.role === "admin" || user?.role === "tutor") && (
          <TabsContent value="export">
            <OrgExportSettings />
          </TabsContent>
        )}

        {(user?.role === "admin" || user?.role === "tutor") && (
          <TabsContent value="availability">
            <TutorAvailabilitySettings />
          </TabsContent>
        )}

        {(user?.role === "admin" || user?.role === "tutor") && (
          <TabsContent value="profile">
            <TutorProfileSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
