import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { Calendar, CheckCircle, AlertCircle, Settings as SettingsIcon, Building, Clock, User as UserIcon } from "lucide-react";
import { supabase } from "../supabase";
import TutorAvailabilitySettings from "../components/TutorAvailabilitySettings";
import OrganizationSettings from "../components/OrganizationSettings";
import BillingInvoiceSettings from "../components/BillingInvoiceSettings";
import TutorProfileSettings from "../components/TutorProfileSettings";
import SubscriptionSettings from "../components/SubscriptionSettings";
import OrgExportSettings from "../components/OrgExportSettings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Receipt, CreditCard, Database } from "lucide-react";

export default function Settings() {
  const { user, checkAuth } = useAuth();
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

    const channel = supabase
      .channel(`profile-google-calendar-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
        load
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
      
      const popup = window.open(
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
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Profile & Org Control</h1>

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
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm flex items-center">
              <AlertCircle className="w-5 h-5 mr-2" />
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md text-sm flex items-center">
              <CheckCircle className="w-5 h-5 mr-2" />
              {success}
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Profile Information</h2>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Full Name</label>
                  <input type="text" disabled value={user?.name || ""} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 bg-gray-50 text-gray-500 sm:text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Email Address</label>
                  <input type="email" disabled value={user?.email || ""} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 bg-gray-50 text-gray-500 sm:text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Role</label>
                  <input type="text" disabled value={user?.role || ""} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 bg-gray-50 text-gray-500 sm:text-sm capitalize" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">Integrations</h2>
              <p className="mt-1 text-sm text-gray-500">Connect third-party services to enhance your experience.</p>
            </div>
            <div className="p-6">
              <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                <div className="flex items-center">
                  <div className="p-2 bg-blue-50 rounded-lg mr-4">
                    <Calendar className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-gray-900">Google Calendar & Meet</h3>
                    <p className="text-sm text-gray-500">Automatically generate Google Meet links for online classes.</p>
                  </div>
                </div>
                <div>
                  {isConnected ? (
                    <div className="flex items-center space-x-4">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Connected
                      </span>
                      <button
                        onClick={handleDisconnectGoogle}
                        disabled={loading}
                        className="text-sm font-medium text-red-600 hover:text-red-500"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleConnectGoogle}
                      disabled={loading}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                      {loading ? "Connecting..." : "Connect Google"}
                    </button>
                  )}
                </div>
              </div>
              
              {!isConnected && (
                <div className="mt-4 bg-blue-50 p-4 rounded-md">
                  <h4 className="text-sm font-medium text-blue-800">Setup Instructions for Google OAuth</h4>
                  <ol className="mt-2 text-sm text-blue-700 list-decimal list-inside space-y-1">
                    <li>Go to Google Cloud Console and create an OAuth Client ID.</li>
                    <li>Add the following URL to your Authorized redirect URIs:</li>
                    <li className="font-mono bg-blue-100 p-1 rounded mt-1 break-all">
                      {window.location.origin}/api/v1/settings/google/callback
                    </li>
                    <li className="mt-2">Ensure you have <code className="bg-blue-100 px-1 rounded">GOOGLE_CLIENT_ID</code> and <code className="bg-blue-100 px-1 rounded">GOOGLE_CLIENT_SECRET</code> set in your environment variables.</li>
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
