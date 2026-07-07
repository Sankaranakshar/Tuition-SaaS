import express from "express";
import { db } from "../db.ts";
import { authenticateToken, requireRole, type AuthRequest } from "../middleware/auth.ts";
import { google } from "googleapis";
import jwt from "jsonwebtoken";
import { encrypt } from "../utils/crypto.ts";

const router = express.Router();
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required for OAuth state tokens. Please set it in the Settings menu.");
  }
  return secret;
};

router.get("/google/url", authenticateToken, requireRole("tutor"), (req: AuthRequest, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/settings/google/callback`
  );

  const stateToken = jwt.sign({ userId: req.user?.id }, getJwtSecret(), { expiresIn: '10m' });

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    state: stateToken
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
    console.error("Invalid state token:", err);
    return res.status(400).send("Invalid or expired state token");
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      `${process.env.APP_URL}/api/settings/google/callback`
    );

    const { tokens } = await oauth2Client.getToken(code as string);
    
    if (tokens.refresh_token) {
      const encryptedToken = encrypt(tokens.refresh_token);
      const stmt = db.prepare("UPDATE users SET google_refresh_token = ? WHERE id = ?");
      stmt.run(encryptedToken, userId);
    }

    const targetOrigin = process.env.APP_URL;
    
    if (!targetOrigin) {
      console.error("APP_URL environment variable is missing. OAuth callback cannot securely send postMessage.");
    }

    res.send(`
      <html>
        <body>
          <script>
            const targetOrigin = "${targetOrigin || ''}";
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

router.post("/google/disconnect", authenticateToken, requireRole("tutor"), (req: AuthRequest, res) => {
  const stmt = db.prepare("UPDATE users SET google_refresh_token = NULL WHERE id = ?");
  stmt.run(req.user?.id);
  res.json({ message: "Disconnected from Google Calendar" });
});

export default router;
