import express from "express";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { adminDb } from "../firebaseAdmin.ts";
import { authenticateToken, requireRole, type AuthRequest } from "../middleware/auth.ts";
import { encrypt } from "../utils/crypto.ts";

const router = express.Router();

// Encrypted Google refresh tokens live in a server-only collection.
// firestore.rules exposes no match for google_tokens, so clients can never
// read or write them; only the Admin SDK (which bypasses rules) can.
const TOKENS_COLLECTION = "google_tokens";

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
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.APP_URL}/api/v1/settings/google/callback`
    );

    const { tokens } = await oauth2Client.getToken(code as string);

    if (tokens.refresh_token) {
      await adminDb.collection(TOKENS_COLLECTION).doc(userId).set({
        refreshToken: encrypt(tokens.refresh_token),
        connectedAt: new Date(),
      });
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
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const snap = await adminDb.collection(TOKENS_COLLECTION).doc(req.user!.id).get();
    res.json({ connected: snap.exists });
  } catch (err) { next(err); }
});

router.post("/google/disconnect", authenticateToken, requireRole(...CALENDAR_ROLES), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    await adminDb.collection(TOKENS_COLLECTION).doc(req.user!.id).delete();
    res.json({ message: "Disconnected from Google Calendar" });
  } catch (err) { next(err); }
});

export default router;
