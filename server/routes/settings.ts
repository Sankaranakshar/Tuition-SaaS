import express from "express";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticateToken, requireRole, type AuthRequest } from "../middleware/auth.ts";
import { encrypt } from "../utils/crypto.ts";

const router = express.Router();

// Encrypted Google refresh tokens live in the server-only google_tokens
// table — no client RLS policy exists for it, so only the service_role key
// (which bypasses RLS) can read or write it.

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required for OAuth state tokens. Set it in the server environment (.env locally, Secret Manager in production).");
  }
  return secret;
};

const CALENDAR_ROLES = ["owner", "admin", "tutor"] as const;

router.get("/google/url", authenticateToken, requireRole(...CALENDAR_ROLES), (req: AuthRequest, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/v1/settings/google/callback`
  );

  const stateToken = jwt.sign({ userId: req.user?.id }, getJwtSecret(), { expiresIn: "10m" });

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    state: stateToken,
  });

  res.json({ url });
});

router.get("/google/callback", async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send("Invalid request");
  }

  let userId: string;
  try {
    const decoded = jwt.verify(state as string, getJwtSecret()) as { userId: string };
    userId = decoded.userId;
  } catch (err) {
    return res.status(400).send("Invalid or expired state token");
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.APP_URL}/api/v1/settings/google/callback`
    );

    const { tokens } = await oauth2Client.getToken(code as string);

    if (tokens.refresh_token) {
      // google_tokens is keyed by (organization_id, user_id) — the state
      // token only carries userId, so resolve the org via membership here.
      const { data: membership, error: memErr } = await supabaseAdmin
        .from("organization_members").select("organization_id").eq("user_id", userId).limit(1).maybeSingle();
      if (memErr) throw memErr;
      if (!membership) throw new Error("User has no organization membership");

      const { error: upsertErr } = await supabaseAdmin.from("google_tokens").upsert({
        organization_id: membership.organization_id,
        user_id: userId,
        refresh_token_enc: encrypt(tokens.refresh_token),
        access_token_enc: tokens.access_token ? encrypt(tokens.access_token) : null,
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      }, { onConflict: "organization_id,user_id" });
      if (upsertErr) throw upsertErr;
    }

    const targetOrigin = process.env.APP_URL;

    if (!targetOrigin) {
      console.error("APP_URL environment variable is missing. OAuth callback cannot securely send postMessage.");
    }

    res.send(`
      <html>
        <body>
          <script>
            const targetOrigin = "${targetOrigin || ""}";
            if (window.opener && targetOrigin) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, targetOrigin);
              window.close();
            } else if (!targetOrigin) {
              document.body.innerHTML = '<p style="color: red;">Configuration error: APP_URL is missing. Please contact support.</p>';
            } else {
              window.location.href = '/settings';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("OAuth callback error", error);
    res.status(500).send("Authentication failed");
  }
});

router.get("/google/status", authenticateToken, requireRole(...CALENDAR_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("google_tokens").select("user_id").eq("user_id", req.user!.id).maybeSingle();
    if (error) throw error;
    res.json({ connected: !!data });
  } catch (err) { next(err); }
});

router.post("/google/disconnect", authenticateToken, requireRole(...CALENDAR_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("google_tokens").delete().eq("user_id", req.user!.id);
    if (error) throw error;
    res.json({ message: "Disconnected from Google Calendar" });
  } catch (err) { next(err); }
});

export default router;
