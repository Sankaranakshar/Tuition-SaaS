import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";

// Checks only the caller's own platform_admins row — RLS
// (platform_admins_select_self) permits nothing broader than that, so this
// can query the table directly rather than needing a server round trip.
export function useIsPlatformAdmin(): boolean {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setIsAdmin(Boolean(data));
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return isAdmin;
}
