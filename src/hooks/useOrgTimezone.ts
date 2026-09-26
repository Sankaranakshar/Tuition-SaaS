import { useEffect, useState } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { DEFAULT_ORG_TIMEZONE } from "../../shared/timezone";

/** The active org's `organizations.timezone` (C-01), so anything that groups
 *  by day, week or month uses the org's calendar rather than the viewer's
 *  browser zone. Any member can read it under `org_select`, parents
 *  included. Falls back to the schema default until loaded or if the read
 *  fails. */
export function useOrgTimezone(): string {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const [zone, setZone] = useState(DEFAULT_ORG_TIMEZONE);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    supabase
      .from("organizations")
      .select("timezone")
      .eq("id", orgId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setZone(data?.timezone || DEFAULT_ORG_TIMEZONE);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return zone;
}
