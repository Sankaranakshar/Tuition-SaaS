// server/app.ts
import express16 from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import pino from "pino-http";
import * as Sentry from "@sentry/node";

// server/routes/settings.ts
import express from "express";
import { google } from "googleapis";
import jwt2 from "jsonwebtoken";

// server/supabaseAdmin.ts
import { createClient } from "@supabase/supabase-js";
var supabaseUrl = process.env.SUPABASE_URL;
var serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.warn("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set \u2014 server-side Supabase calls will fail.");
}
var supabaseAdmin = createClient(supabaseUrl || "http://localhost:54321", serviceRoleKey || "placeholder", {
  auth: { autoRefreshToken: false, persistSession: false }
});

// server/middleware/auth.ts
import jwt from "jsonwebtoken";
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from "jose";

// server/db.ts
import { Pool } from "pg";
var connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("DATABASE_URL not set \u2014 transactional Postgres routes will fail.");
}
var pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX) || 3,
  // Return idle connections to the Supabase pooler rather than pinning them
  // for the life of a serverless instance that may handle one request a minute.
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 1e4,
  // Fail fast when the pooler is saturated instead of queueing a request
  // behind a checkout that will never come.
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5e3,
  keepAlive: true,
  application_name: "classstackr-api",
  // Ceiling on any single statement. Generous enough for the org export and
  // the cron materialize sweep, low enough that a pathological query can't
  // hold a pool slot indefinitely.
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 3e4,
  // Backstop for a transaction whose caller died mid-flight.
  idle_in_transaction_session_timeout: Number(process.env.PG_IDLE_TX_TIMEOUT_MS) || 3e4
});
pool.on("error", (err) => {
  console.error("Idle Postgres client error (connection evicted):", err);
});
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw err;
  } finally {
    client.release();
  }
}

// server/middleware/auth.ts
var SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
var SUPABASE_URL = process.env.SUPABASE_URL;
var jwks = SUPABASE_URL ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)) : null;
async function verifyAccessToken(token) {
  const alg = decodeProtectedHeader(token).alg;
  if (alg === "HS256") {
    if (!SUPABASE_JWT_SECRET) {
      throw new Error("HS256 token received but SUPABASE_JWT_SECRET is not configured");
    }
    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, { algorithms: ["HS256"] });
    if (!decoded.sub) throw new Error("Missing sub claim");
    return { sub: decoded.sub, email: decoded.email };
  }
  if (!jwks) {
    throw new Error("SUPABASE_URL is required to verify asymmetric access tokens");
  }
  const { payload } = await jwtVerify(token, jwks);
  if (!payload.sub) throw new Error("Missing sub claim");
  return { sub: payload.sub, email: payload.email };
}
var MEMBERSHIP_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS) || 0;
var membershipCache = /* @__PURE__ */ new Map();
function invalidateMembership(userId) {
  membershipCache.delete(userId);
}
function invalidateAllMemberships() {
  membershipCache.clear();
}
async function loadMembership(userId) {
  if (MEMBERSHIP_TTL_MS > 0) {
    const hit = membershipCache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }
  const { rows } = await pool.query(
    `select om.organization_id, om.role, o.status as organization_status
     from organization_members om
     join organizations o on o.id = om.organization_id
     where om.user_id = $1
     order by om.created_at asc
     limit 1`,
    [userId]
  );
  const row = rows[0];
  const value = {
    organizationId: row?.organization_id ?? void 0,
    role: row?.role ?? void 0,
    organizationStatus: row?.organization_status ?? void 0
  };
  if (MEMBERSHIP_TTL_MS > 0) {
    membershipCache.set(userId, { value, expiresAt: Date.now() + MEMBERSHIP_TTL_MS });
  }
  return value;
}
var authenticateToken = async (req, res, next) => {
  const authHeader2 = req.headers["authorization"];
  const token = authHeader2?.startsWith("Bearer ") ? authHeader2.slice(7) : void 0;
  if (!token || token === "undefined" || token === "null") {
    return res.status(401).json({ error: { code: "unauthenticated", message: "Missing bearer token" } });
  }
  try {
    const { sub: userId, email } = await verifyAccessToken(token);
    const membership = await loadMembership(userId);
    req.user = {
      id: userId,
      email,
      role: membership.role,
      organizationId: membership.organizationId,
      organizationStatus: membership.organizationStatus
    };
    next();
  } catch (err) {
    console.error("authenticateToken failed:", err);
    return res.status(401).json({ error: { code: "unauthenticated", message: "Invalid or expired token" } });
  }
};
var requireRole = (...roles) => {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: { code: "forbidden", message: "Insufficient role" } });
    }
    next();
  };
};
var requireOrg = (req, res, next) => {
  if (!req.user?.organizationId) {
    return res.status(403).json({ error: { code: "no_organization", message: "User does not belong to an organization" } });
  }
  if (req.user.organizationStatus === "offboarded") {
    return res.status(403).json({ error: { code: "org_offboarded", message: "This organization has been offboarded" } });
  }
  next();
};
var requirePlatformAdmin = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: { code: "unauthenticated", message: "Missing bearer token" } });
    const { rowCount } = await pool.query(`select 1 from platform_admins where user_id = $1 limit 1`, [userId]);
    if (!rowCount) return res.status(403).json({ error: { code: "forbidden", message: "Not a platform admin" } });
    next();
  } catch (err) {
    console.error("requirePlatformAdmin failed:", err);
    return res.status(500).json({ error: { code: "internal", message: "Failed to verify platform-admin access" } });
  }
};

// server/utils/crypto.ts
import crypto from "crypto";
var encryptionKey = null;
function getEncryptionKey() {
  if (!encryptionKey) {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      throw new Error("ENCRYPTION_KEY environment variable is required for secure token storage. Set it in the server environment (.env locally, Secret Manager in production). Generate one with: openssl rand -hex 32");
    }
    if (key.length === 64) {
      encryptionKey = Buffer.from(key, "hex");
    } else {
      encryptionKey = crypto.createHash("sha256").update(String(key)).digest();
    }
  }
  return encryptionKey;
}
var IV_LENGTH = 12;
function encrypt(text) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `v1:${iv.toString("hex")}:${authTag}:${encrypted}`;
}
function decrypt(text) {
  try {
    const key = getEncryptionKey();
    const parts = text.split(":");
    const [ivHex, authTagHex, encryptedHex] = parts[0] === "v1" ? parts.slice(1) : parts;
    if (!ivHex || !authTagHex || !encryptedHex) {
      throw new Error("Invalid encrypted text format");
    }
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encryptedText = Buffer.from(encryptedHex, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedText, void 0, "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Failed to decrypt token:", error);
    return null;
  }
}

// server/routes/settings.ts
var router = express.Router();
var getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required for OAuth state tokens. Set it in the server environment (.env locally, Secret Manager in production).");
  }
  return secret;
};
var CALENDAR_ROLES = ["owner", "admin", "tutor"];
router.get("/google/url", authenticateToken, requireRole(...CALENDAR_ROLES), (req, res) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.APP_URL}/api/v1/settings/google/callback`
  );
  const stateToken = jwt2.sign({ userId: req.user?.id }, getJwtSecret(), { expiresIn: "10m" });
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
  let userId;
  try {
    const decoded = jwt2.verify(state, getJwtSecret());
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
    const { tokens } = await oauth2Client.getToken(code);
    if (tokens.refresh_token) {
      const { data: membership, error: memErr } = await supabaseAdmin.from("organization_members").select("organization_id").eq("user_id", userId).order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (memErr) throw memErr;
      if (!membership) throw new Error("User has no organization membership");
      const { error: upsertErr } = await supabaseAdmin.from("google_tokens").upsert({
        organization_id: membership.organization_id,
        user_id: userId,
        refresh_token_enc: encrypt(tokens.refresh_token),
        access_token_enc: tokens.access_token ? encrypt(tokens.access_token) : null,
        expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null
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
router.get("/google/status", authenticateToken, requireRole(...CALENDAR_ROLES), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from("google_tokens").select("user_id").eq("user_id", req.user.id).maybeSingle();
    if (error) throw error;
    res.json({ connected: !!data });
  } catch (err) {
    next(err);
  }
});
router.post("/google/disconnect", authenticateToken, requireRole(...CALENDAR_ROLES), async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin.from("google_tokens").delete().eq("user_id", req.user.id);
    if (error) throw error;
    res.json({ message: "Disconnected from Google Calendar" });
  } catch (err) {
    next(err);
  }
});
var settings_default = router;

// server/routes/members.ts
import express2 from "express";
import crypto2 from "node:crypto";

// server/utils/audit.ts
async function writeAudit(organizationId, actor, action, entityType, entityId, summary) {
  const systemActor = typeof actor === "object" ? actor.system : null;
  try {
    await pool.query(
      `insert into audit_events (organization_id, actor_id, action, payload)
       values ($1, $2, $3, $4::jsonb)`,
      [
        organizationId,
        systemActor ? null : actor,
        action,
        // systemActor goes after ...summary so a caller's summary key can
        // never shadow it — the audit viewer reads it to label the row.
        JSON.stringify({ entityType, entityId, ...summary, ...systemActor ? { systemActor } : {} })
      ]
    );
  } catch (error) {
    console.error("Failed to write audit event", error);
  }
}

// shared/schemas/members.ts
import { z } from "zod";
var ORG_ROLES = ["owner", "admin", "tutor", "frontdesk", "accountant", "parent", "student"];
var setMemberRoleRequestSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ORG_ROLES)
});
var bootstrapOrgRequestSchema = z.object({ organizationName: z.string().min(2).max(120) });
var INVITABLE_STAFF_ROLES = ["admin", "tutor", "frontdesk", "accountant"];
var createStaffInviteRequestSchema = z.object({ role: z.enum(INVITABLE_STAFF_ROLES) });
var staffRedeemRequestSchema = z.object({ token: z.string().min(10) });

// server/routes/members.ts
var router2 = express2.Router();
var INVITE_TTL_MS = 7 * 24 * 3600 * 1e3;
async function setMembership(orgId, userId, role, _actorId) {
  const { error } = await supabaseAdmin.from("organization_members").upsert({ organization_id: orgId, user_id: userId, role }, { onConflict: "organization_id,user_id" });
  if (error) throw error;
  invalidateMembership(userId);
  const { error: profileErr } = await supabaseAdmin.from("profiles").update({ organization_id: orgId }).eq("id", userId);
  if (profileErr) throw profileErr;
}
router2.post("/bootstrap", authenticateToken, async (req, res, next) => {
  try {
    if (req.user?.organizationId) {
      return res.status(409).json({ error: { code: "already_member", message: "User already belongs to an organization" } });
    }
    const body = bootstrapOrgRequestSchema.parse(req.body);
    const { data: org, error: orgErr } = await supabaseAdmin.from("organizations").insert({ name: body.organizationName }).select("id").single();
    if (orgErr) throw orgErr;
    await setMembership(org.id, req.user.id, "owner", req.user.id);
    await writeAudit(org.id, req.user.id, "org.create", "organizations", org.id, { name: body.organizationName });
    res.status(201).json({ organizationId: org.id });
  } catch (err) {
    next(err);
  }
});
router2.put("/", authenticateToken, requireOrg, requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const body = setMemberRoleRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    if ((body.role === "owner" || body.role === "admin") && req.user.role !== "owner") {
      return res.status(403).json({ error: { code: "forbidden", message: "Only the owner can grant owner or admin roles" } });
    }
    await setMembership(orgId, body.userId, body.role, req.user.id);
    await writeAudit(orgId, req.user.id, "member.set_role", "organization_members", `${orgId}_${body.userId}`, { role: body.role });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
router2.delete("/:userId", authenticateToken, requireOrg, requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const { userId } = req.params;
    if (userId === req.user.id) {
      return res.status(400).json({ error: { code: "cannot_remove_self", message: "Transfer ownership before leaving" } });
    }
    const { error } = await supabaseAdmin.from("organization_members").delete().eq("organization_id", orgId).eq("user_id", userId);
    if (error) throw error;
    invalidateMembership(userId);
    await writeAudit(orgId, req.user.id, "member.remove", "organization_members", `${orgId}_${userId}`, {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
router2.post("/invites", authenticateToken, requireOrg, requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const body = createStaffInviteRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    if (body.role === "admin" && req.user.role !== "owner") {
      return res.status(403).json({ error: { code: "forbidden", message: "Only the owner can invite an admin" } });
    }
    const token = crypto2.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const { error } = await supabaseAdmin.from("staff_invites").insert({
      token,
      organization_id: orgId,
      role: body.role,
      invited_by: req.user.id,
      expires_at: expiresAt.toISOString()
    });
    if (error) throw error;
    await writeAudit(orgId, req.user.id, "staff_invite.create", "organization_members", orgId, { role: body.role, token: token.slice(0, 8) + "\u2026" });
    res.status(201).json({ ok: true, token, expiresAt: expiresAt.toISOString(), role: body.role });
  } catch (err) {
    next(err);
  }
});
async function loadStaffInvite(token) {
  const { data: invite, error } = await supabaseAdmin.from("staff_invites").select("*").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!invite) {
    throw Object.assign(new Error("Invite not found"), { status: 404, code: "not_found" });
  }
  if (invite.used_at) {
    throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error("Invite expired"), { status: 410, code: "invite_expired" });
  }
  return invite;
}
router2.get("/invites/:token/preview", authenticateToken, async (req, res, next) => {
  try {
    const invite = await loadStaffInvite(req.params.token);
    const { data: org } = await supabaseAdmin.from("organizations").select("name").eq("id", invite.organization_id).maybeSingle();
    res.json({ ok: true, organizationName: org?.name || null, role: invite.role });
  } catch (err) {
    next(err);
  }
});
router2.post("/invites/redeem", authenticateToken, async (req, res, next) => {
  try {
    const body = staffRedeemRequestSchema.parse(req.body);
    const uid = req.user.id;
    const invite = await loadStaffInvite(body.token);
    if (req.user.organizationId && req.user.organizationId !== invite.organization_id) {
      return res.status(409).json({ error: { code: "org_conflict", message: "Account is already linked to a different organization" } });
    }
    await withTransaction(async (client) => {
      const freshInvite = await client.query(`select used_at from staff_invites where token = $1 for update`, [body.token]);
      if (freshInvite.rows[0]?.used_at) {
        throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
      }
      await client.query(`update staff_invites set used_at = now(), used_by = $1 where token = $2`, [uid, body.token]);
    });
    await setMembership(invite.organization_id, uid, invite.role, uid);
    await writeAudit(invite.organization_id, uid, "staff_invite.redeem", "organization_members", `${invite.organization_id}_${uid}`, { role: invite.role });
    res.json({ ok: true, organizationId: invite.organization_id, role: invite.role });
  } catch (err) {
    next(err);
  }
});
var members_default = router2;

// server/routes/billing.ts
import express3 from "express";

// server/utils/invoiceStatus.ts
var PAYABLE = /* @__PURE__ */ new Set(["draft", "sent", "unpaid", "partially_paid"]);
function applyPayment(inv, amountPaise) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw Object.assign(new Error("Payment amount must be a positive integer (paise)"), {
      status: 422,
      code: "invalid_amount"
    });
  }
  if (inv.status === "void") {
    throw Object.assign(new Error("Invoice is void"), { status: 422, code: "invoice_void" });
  }
  if (!PAYABLE.has(inv.status)) {
    throw Object.assign(new Error(`Invoice in status "${inv.status}" cannot take a payment`), {
      status: 422,
      code: "not_payable"
    });
  }
  const prospective = inv.paidPaise + amountPaise;
  const overpaidPaise = Math.max(0, prospective - inv.totalPaise);
  const paidPaise = Math.min(prospective, inv.totalPaise);
  const fullyPaid = paidPaise >= inv.totalPaise;
  const status = fullyPaid ? "paid" : "partially_paid";
  return { paidPaise, status, overpaidPaise, fullyPaid };
}

// server/utils/invoiceNumber.ts
function formatInvoiceNumber(orgSlug, year, seq) {
  const slug = (orgSlug || "ORG").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "ORG";
  return `INV-${slug}-${year}-${String(seq).padStart(4, "0")}`;
}
async function allocateInvoiceNumber(client, orgId, orgSlug, when = /* @__PURE__ */ new Date()) {
  const year = when.getFullYear();
  const res = await client.query(
    `insert into invoice_counters (organization_id, year, seq)
     values ($1, $2, 1)
     on conflict (organization_id, year)
     do update set seq = invoice_counters.seq + 1
     returning seq`,
    [orgId, year]
  );
  const seq = res.rows[0].seq;
  return { number: formatInvoiceNumber(orgSlug, year, seq), seq, year };
}

// server/utils/razorpay.ts
import crypto3 from "crypto";
var RZP_API = "https://api.razorpay.com/v1";
function verifyWebhookSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto3.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return crypto3.timingSafeEqual(a, b);
}
async function getGatewayCreds(orgId) {
  const { data, error } = await supabaseAdmin.from("payment_gateways").select("key_id, key_secret_enc, webhook_secret_enc").eq("organization_id", orgId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const keyId = data.key_id;
  const keySecret = data.key_secret_enc ? decrypt(data.key_secret_enc) : null;
  const webhookSecret = data.webhook_secret_enc ? decrypt(data.webhook_secret_enc) : null;
  if (!keyId || !keySecret || !webhookSecret) return null;
  return { keyId, keySecret, webhookSecret };
}
function authHeader(creds) {
  return "Basic " + Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
}
async function createPaymentLink(creds, params) {
  const res = await fetch(`${RZP_API}/payment_links`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader(creds) },
    body: JSON.stringify({
      amount: params.amountPaise,
      currency: "INR",
      accept_partial: false,
      reference_id: params.referenceId,
      description: params.description.slice(0, 2048),
      customer: params.customer,
      notify: { sms: false, email: false },
      // we deliver via our own channel router (Epic 7)
      reminder_enable: false,
      notes: params.notes,
      callback_url: params.callbackUrl,
      callback_method: params.callbackUrl ? "get" : void 0
    })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = json?.error?.description || `Razorpay error ${res.status}`;
    throw Object.assign(new Error(message), { status: 502, code: "gateway_error" });
  }
  return { id: json.id, shortUrl: json.short_url, status: json.status };
}
async function fetchPaymentLink(creds, linkId) {
  const res = await fetch(`${RZP_API}/payment_links/${linkId}`, {
    headers: { Authorization: authHeader(creds) }
  });
  if (!res.ok) throw Object.assign(new Error(`Razorpay error ${res.status}`), { status: 502, code: "gateway_error" });
  return res.json();
}

// server/utils/invoicePdf.ts
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// shared/money.ts
function rupeesToPaise(rupees) {
  return Math.round(rupees * 100);
}
function paiseToRupees(paise2) {
  return paise2 / 100;
}

// server/utils/invoicePdf.ts
var inrNumber = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0
});
function paise(v) {
  return `Rs. ${inrNumber.format(paiseToRupees(v || 0))}`;
}
function readDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function formatDate(d) {
  const parsed = readDate(d);
  if (!parsed) return "\u2014";
  return parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
function resolveInvoiceTotals(inv) {
  const total = inv.totalPaise ?? rupeesToPaise(inv.totalAmount || 0);
  const subtotal = inv.subtotalPaise ?? rupeesToPaise(inv.subtotal ?? inv.totalAmount ?? 0);
  const tax = inv.taxPaise ?? 0;
  const discount = inv.discountPaise ?? 0;
  const paid = inv.paidPaise ?? 0;
  const outstanding = Math.max(0, total - paid);
  return { subtotal, tax, discount, total, paid, outstanding };
}
function renderInvoicePdf(input) {
  const { invoice, org, student } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;
  let cursorY = 48;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(org.name, marginX, cursorY);
  doc.setFontSize(20);
  doc.setTextColor(60);
  doc.text("INVOICE", pageWidth - marginX, cursorY, { align: "right" });
  doc.setTextColor(0);
  cursorY += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const orgLines = [];
  if (org.address) orgLines.push(org.address);
  const contact = [org.phone, org.email].filter(Boolean).join(" \xB7 ");
  if (contact) orgLines.push(contact);
  if (org.gstin) orgLines.push(`GSTIN: ${org.gstin}`);
  for (const line of orgLines) {
    doc.text(line, marginX, cursorY);
    cursorY += 13;
  }
  const metaX = pageWidth - marginX;
  let metaY = 66;
  doc.setFont("helvetica", "bold");
  doc.text(invoice.invoiceNumber || "DRAFT", metaX, metaY, { align: "right" });
  doc.setFont("helvetica", "normal");
  metaY += 14;
  doc.text(`Issued: ${formatDate(invoice.createdAt)}`, metaX, metaY, { align: "right" });
  if (invoice.dueDate) {
    metaY += 13;
    doc.text(`Due: ${formatDate(invoice.dueDate)}`, metaX, metaY, { align: "right" });
  }
  metaY += 13;
  doc.text(`Status: ${invoice.status.replace("_", " ")}`, metaX, metaY, { align: "right" });
  cursorY = Math.max(cursorY, metaY) + 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Bill to", marginX, cursorY);
  cursorY += 14;
  doc.setFont("helvetica", "normal");
  const billLines = [];
  if (student.parentName) billLines.push(student.parentName);
  if (student.name) billLines.push(`Student: ${student.name}`);
  if (student.address) billLines.push(student.address);
  const parentContact = [student.parentPhone, student.parentEmail].filter(Boolean).join(" \xB7 ");
  if (parentContact) billLines.push(parentContact);
  if (billLines.length === 0) billLines.push("\u2014");
  for (const line of billLines) {
    doc.text(line, marginX, cursorY);
    cursorY += 13;
  }
  if (invoice.gstSnapshot?.placeOfSupply) {
    cursorY += 4;
    doc.text(`Place of supply: ${invoice.gstSnapshot.placeOfSupply}`, marginX, cursorY);
    cursorY += 13;
  }
  cursorY += 12;
  const items = invoice.items && invoice.items.length > 0 ? invoice.items : [{ description: "Tuition fees", quantity: 1, amountPaise: invoice.totalPaise || rupeesToPaise(invoice.totalAmount || 0) }];
  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    head: [["Description", "Qty", "Amount"]],
    body: items.map((i) => [
      i.description,
      String(i.quantity ?? 1),
      paise(i.amountPaise * (i.quantity ?? 1))
    ]),
    styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: {
      1: { halign: "right", cellWidth: 50 },
      2: { halign: "right", cellWidth: 100 }
    }
  });
  const totals = resolveInvoiceTotals(invoice);
  const afterTable = doc.lastAutoTable?.finalY ?? cursorY + 40;
  let totalsY = afterTable + 20;
  const totalsX = pageWidth - marginX;
  const labelX = totalsX - 130;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const row = (label, value) => {
    doc.text(label, labelX, totalsY);
    doc.text(value, totalsX, totalsY, { align: "right" });
    totalsY += 14;
  };
  row("Subtotal", paise(totals.subtotal));
  if (totals.discount > 0) row("Discount", `\u2212 ${paise(totals.discount)}`);
  if (totals.tax > 0) row("Tax", paise(totals.tax));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  row("Total", paise(totals.total));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (totals.paid > 0) row("Paid", paise(totals.paid));
  if (totals.outstanding > 0 || totals.paid > 0) {
    doc.setFont("helvetica", "bold");
    row("Outstanding", paise(totals.outstanding));
    doc.setFont("helvetica", "normal");
  }
  totalsY += 30;
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    "This is a computer-generated document. For questions about this invoice, contact the tuition center.",
    marginX,
    doc.internal.pageSize.getHeight() - 32
  );
  return Buffer.from(doc.output("arraybuffer"));
}

// shared/schemas/billing.ts
import { z as z2 } from "zod";
var paymentMethodSchema = z2.enum(["cash", "upi", "bank_transfer", "cheque", "other"]);
var createInvoiceRequestSchema = z2.object({
  studentId: z2.string().uuid(),
  items: z2.array(z2.object({
    description: z2.string().min(1),
    amount: z2.number().nonnegative(),
    // rupees, as entered in the line-item form
    quantity: z2.number().int().positive()
  })).min(1),
  taxPercentage: z2.number().min(0).max(100).optional().default(0),
  dueDate: z2.string().optional()
});
var createInvoiceResponseSchema = z2.object({ ok: z2.literal(true), invoiceId: z2.string().uuid() });
var topupRequestSchema = z2.object({
  studentId: z2.string().uuid(),
  amountPaise: z2.number().int().positive(),
  method: paymentMethodSchema,
  idempotencyKey: z2.string().min(8).max(128),
  note: z2.string().max(500).optional()
});
var topupResponseSchema = z2.object({ ok: z2.literal(true), duplicate: z2.boolean() });
var attendanceStatusSchema = z2.enum(["present", "absent", "late", "excused"]);
var markAttendanceRequestSchema = z2.object({
  sessionId: z2.string().uuid(),
  records: z2.array(z2.object({
    studentId: z2.string().uuid(),
    status: attendanceStatusSchema
  })).min(1)
});
var markAttendanceResponseSchema = z2.object({
  ok: z2.literal(true),
  billed: z2.array(z2.string()),
  invoiced: z2.array(z2.string())
});
var cancelSessionRequestSchema = z2.object({ sessionId: z2.string().uuid() });
var cancelSessionResponseSchema = z2.object({ ok: z2.literal(true) });
var recordManualPaymentRequestSchema = z2.object({
  invoiceId: z2.string().uuid(),
  amountPaise: z2.number().int().positive(),
  method: paymentMethodSchema,
  idempotencyKey: z2.string().min(8).max(128),
  note: z2.string().max(500).optional()
});
var recordManualPaymentResponseSchema = z2.object({
  ok: z2.literal(true),
  invoiceStatus: z2.string(),
  duplicate: z2.boolean()
});
var refundRequestSchema = z2.object({
  invoiceId: z2.string().uuid(),
  amountPaise: z2.number().int().positive(),
  reason: z2.string().max(500).optional(),
  idempotencyKey: z2.string().min(8).max(128)
});
var refundResponseSchema = z2.object({
  ok: z2.literal(true),
  invoiceStatus: z2.string(),
  duplicate: z2.boolean()
});
var voidInvoiceResponseSchema = z2.object({ ok: z2.literal(true) });
var finalizeInvoiceResponseSchema = z2.object({ ok: z2.literal(true), invoiceNumber: z2.string() });
var paymentLinkResponseSchema = z2.object({ ok: z2.literal(true), shortUrl: z2.string(), reused: z2.boolean() });

// server/routes/billing.ts
var router3 = express3.Router();
router3.use(authenticateToken, requireOrg);
var CAN_MARK = ["owner", "admin", "tutor", "frontdesk"];
var CAN_MONEY = ["owner", "admin", "frontdesk"];
router3.post("/invoices", requireRole(...CAN_MARK), async (req, res, next) => {
  try {
    const body = createInvoiceRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const subtotalPaise = body.items.reduce((sum, it) => sum + rupeesToPaise(it.amount * it.quantity), 0);
    const taxPaise = Math.round(subtotalPaise * body.taxPercentage / 100);
    const totalPaise = subtotalPaise + taxPaise;
    const items = body.items.map((it) => ({
      description: it.description,
      amountPaise: rupeesToPaise(it.amount),
      quantity: it.quantity
    }));
    const { data: inv, error } = await supabaseAdmin.from("invoices").insert({
      organization_id: orgId,
      tutor_id: req.user.role === "tutor" ? req.user.id : null,
      student_id: body.studentId,
      subtotal_paise: subtotalPaise,
      tax_paise: taxPaise,
      discount_paise: 0,
      total_paise: totalPaise,
      total_amount: paiseToRupees(totalPaise),
      subtotal: paiseToRupees(subtotalPaise),
      status: "unpaid",
      due_date: body.dueDate || null,
      items
    }).select("id").single();
    if (error) throw error;
    await writeAudit(orgId, req.user.id, "invoice.create", "invoices", inv.id, { studentId: body.studentId, totalPaise });
    res.status(201).json({ ok: true, invoiceId: inv.id });
  } catch (err) {
    next(err);
  }
});
router3.post("/wallets/topup", requireRole(...CAN_MONEY), async (req, res, next) => {
  try {
    const body = topupRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const outcome = await withTransaction(async (client) => {
      const existing = await client.query(
        `select 1 from wallet_ledger where organization_id = $1 and idempotency_key = $2`,
        [orgId, body.idempotencyKey]
      );
      if ((existing.rowCount ?? 0) > 0) return { duplicate: true };
      const walletRes = await client.query(
        `insert into wallets (organization_id, student_id) values ($1, $2)
         on conflict (organization_id, student_id) do update set student_id = excluded.student_id
         returning id`,
        [orgId, body.studentId]
      );
      await client.query(
        `update wallets set balance_currency = balance_currency + $1 where id = $2`,
        [paiseToRupees(body.amountPaise), walletRes.rows[0].id]
      );
      await client.query(
        `insert into wallet_ledger (organization_id, student_id, type, credits, paise, reason, by, idempotency_key, at)
         values ($1, $2, 'credit_currency', 0, $3, 'topup', $4, $5, now())`,
        [orgId, body.studentId, body.amountPaise, req.user.id, body.idempotencyKey]
      );
      return { duplicate: false };
    });
    if (!outcome.duplicate) {
      await writeAudit(orgId, req.user.id, "wallet.topup", "wallets", body.studentId, { amountPaise: body.amountPaise, method: body.method });
    }
    res.status(outcome.duplicate ? 200 : 201).json({ ok: true, duplicate: outcome.duplicate });
  } catch (err) {
    next(err);
  }
});
router3.post("/attendance", requireRole(...CAN_MARK), async (req, res, next) => {
  try {
    const { sessionId, records } = markAttendanceRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const actor = req.user.id;
    const sessionRes = await pool.query(
      `select s.organization_id, s.tutor_id, s.template_id, s.start_time,
              t.pricing_model, t.fee_amount, t.type
       from class_sessions s
       left join class_templates t on t.id = s.template_id
       where s.id = $1`,
      [sessionId]
    );
    if (sessionRes.rowCount === 0) {
      return res.status(404).json({ error: { code: "not_found", message: "Session not found" } });
    }
    const session = sessionRes.rows[0];
    if (session.organization_id !== orgId) {
      return res.status(403).json({ error: { code: "forbidden", message: "Session belongs to another organization" } });
    }
    if (req.user.role === "tutor" && session.tutor_id !== actor) {
      return res.status(403).json({ error: { code: "forbidden", message: "Tutors can only mark their own sessions" } });
    }
    const start = new Date(session.start_time);
    if (start.getTime() > Date.now()) {
      return res.status(422).json({ error: { code: "session_in_future", message: "Cannot mark attendance before the session starts" } });
    }
    if (Date.now() - start.getTime() > 7 * 24 * 3600 * 1e3) {
      return res.status(422).json({ error: { code: "too_old", message: "Attendance can only be marked within 7 days of the session" } });
    }
    const template = session.template_id ? { pricing_model: session.pricing_model, fee_amount: session.fee_amount, type: session.type } : null;
    const perSession = template?.pricing_model === "PER_SESSION";
    const BILLABLE = /* @__PURE__ */ new Set(["present", "late"]);
    const result = await withTransaction(async (client) => {
      const billed = [];
      const invoiced = [];
      const statusByStudent = /* @__PURE__ */ new Map();
      for (const r of records) statusByStudent.set(r.studentId, r.status);
      const studentIds = [...statusByStudent.keys()];
      const prevRes = await client.query(
        `select student_id from attendance_records
         where session_id = $1 and student_id = any($2::uuid[]) and billed = true`,
        [sessionId, studentIds]
      );
      const alreadyBilled = new Set(prevRes.rows.map((r) => r.student_id));
      const marks = studentIds.map((studentId) => {
        const status = statusByStudent.get(studentId);
        const shouldBill = perSession && BILLABLE.has(status) && !alreadyBilled.has(studentId);
        return { studentId, status, shouldBill, billed: alreadyBilled.has(studentId) || shouldBill };
      });
      await client.query(
        `insert into attendance_records
           (organization_id, session_id, student_id, template_id, tutor_id, session_start, status, billed, marked_by, marked_at)
         select $1, $2, v.student_id, $3, $4, $5, v.status, v.billed, $6, now()
         from unnest($7::uuid[], $8::text[], $9::boolean[]) as v(student_id, status, billed)
         on conflict (session_id, student_id) do update set
           status = excluded.status, billed = excluded.billed, marked_by = excluded.marked_by, marked_at = now()`,
        [
          orgId,
          sessionId,
          session.template_id,
          session.tutor_id,
          session.start_time,
          actor,
          marks.map((m) => m.studentId),
          marks.map((m) => m.status),
          marks.map((m) => m.billed)
        ]
      );
      const toBill = marks.filter((m) => m.shouldBill);
      if (toBill.length > 0) {
        const feePaise = rupeesToPaise(template.fee_amount || 0);
        const walletRes = await client.query(
          `select id, student_id, balance_credits, balance_currency from wallets
           where organization_id = $1 and student_id = any($2::uuid[])
           order by student_id
           for update`,
          [orgId, toBill.map((m) => m.studentId)]
        );
        const walletByStudent = new Map(walletRes.rows.map((w) => [w.student_id, w]));
        const creditWalletIds = [];
        const currencyWalletIds = [];
        const ledger = [];
        const invoiceStudentIds = [];
        for (const m of toBill) {
          const w = walletByStudent.get(m.studentId);
          if (w && (w.balance_credits || 0) >= 1) {
            creditWalletIds.push(w.id);
            ledger.push({ studentId: m.studentId, type: "debit_credit", credits: -1, paise: 0 });
            billed.push(m.studentId);
          } else if (w && rupeesToPaise(w.balance_currency || 0) >= feePaise) {
            currencyWalletIds.push(w.id);
            ledger.push({ studentId: m.studentId, type: "debit_currency", credits: 0, paise: -feePaise });
            billed.push(m.studentId);
          } else {
            invoiceStudentIds.push(m.studentId);
            invoiced.push(m.studentId);
          }
        }
        if (creditWalletIds.length > 0) {
          await client.query(
            `update wallets set balance_credits = balance_credits - 1 where id = any($1::uuid[])`,
            [creditWalletIds]
          );
        }
        if (currencyWalletIds.length > 0) {
          await client.query(
            `update wallets set balance_currency = balance_currency - $1 where id = any($2::uuid[])`,
            [paiseToRupees(feePaise), currencyWalletIds]
          );
        }
        if (ledger.length > 0) {
          await client.query(
            `insert into wallet_ledger (organization_id, student_id, type, credits, paise, reason, session_id, by, at)
             select $1, v.student_id, v.type, v.credits, v.paise, 'attendance', $2, $3, now()
             from unnest($4::uuid[], $5::text[], $6::int[], $7::int[]) as v(student_id, type, credits, paise)`,
            [
              orgId,
              sessionId,
              actor,
              ledger.map((l) => l.studentId),
              ledger.map((l) => l.type),
              ledger.map((l) => l.credits),
              ledger.map((l) => l.paise)
            ]
          );
        }
        if (invoiceStudentIds.length > 0) {
          const due = new Date(Date.now() + 7 * 24 * 3600 * 1e3);
          const items = [{ description: `${template.type} session on ${start.toISOString().split("T")[0]}`, amountPaise: feePaise, quantity: 1 }];
          await client.query(
            `insert into invoices
               (organization_id, tutor_id, student_id, subtotal_paise, total_paise, tax_paise, discount_paise, total_amount, subtotal, status, due_date, items, source)
             select $1, $2, v.student_id, $3, $3, 0, 0, $4, $4, 'unpaid', $5, $6::jsonb, $7::jsonb
             from unnest($8::uuid[]) as v(student_id)`,
            [
              orgId,
              session.tutor_id,
              feePaise,
              paiseToRupees(feePaise),
              due.toISOString().split("T")[0],
              JSON.stringify(items),
              JSON.stringify({ kind: "attendance", sessionId }),
              invoiceStudentIds
            ]
          );
        }
      }
      await client.query(
        `update class_sessions set status = 'completed', attendance_marked_at = now(), attendance_marked_by = $1 where id = $2`,
        [actor, sessionId]
      );
      return { billed, invoiced };
    });
    await writeAudit(orgId, actor, "attendance.mark", "class_sessions", sessionId, {
      records: records.map((r) => `${r.studentId}:${r.status}`),
      ...result
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});
router3.post("/sessions/cancel", requireRole(...CAN_MARK), async (req, res, next) => {
  try {
    const { sessionId } = cancelSessionRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const { data: session, error } = await supabaseAdmin.from("class_sessions").select("organization_id, tutor_id").eq("id", sessionId).maybeSingle();
    if (error) throw error;
    if (!session || session.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Session not found" } });
    }
    if (req.user.role === "tutor" && session.tutor_id !== req.user.id) {
      return res.status(403).json({ error: { code: "forbidden", message: "Tutors can only cancel their own sessions" } });
    }
    const { error: updErr } = await supabaseAdmin.from("class_sessions").update({ status: "cancelled", cancelled_at: (/* @__PURE__ */ new Date()).toISOString(), cancelled_by: req.user.id }).eq("id", sessionId);
    if (updErr) throw updErr;
    await writeAudit(orgId, req.user.id, "session.cancel", "class_sessions", sessionId, {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
router3.post("/payments/manual", requireRole(...CAN_MONEY), async (req, res, next) => {
  try {
    const body = recordManualPaymentRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const outcome = await withTransaction(async (client) => {
      const existing = await client.query(
        `select invoice_status from payments where organization_id = $1 and idempotency_key = $2`,
        [orgId, body.idempotencyKey]
      );
      if ((existing.rowCount ?? 0) > 0) {
        return { duplicate: true, status: existing.rows[0].invoice_status };
      }
      const invRes = await client.query(
        `select organization_id, student_id, status, total_paise, paid_paise from invoices where id = $1 for update`,
        [body.invoiceId]
      );
      if (invRes.rowCount === 0 || invRes.rows[0].organization_id !== orgId) {
        throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
      }
      const inv = invRes.rows[0];
      const applied = applyPayment(
        { status: inv.status, totalPaise: inv.total_paise, paidPaise: inv.paid_paise },
        body.amountPaise
      );
      await client.query(
        `insert into payments
           (organization_id, invoice_id, student_id, amount_paise, method, note, recorded_by, invoice_status, idempotency_key, at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
        [orgId, body.invoiceId, inv.student_id, body.amountPaise, body.method, body.note || null, req.user.id, applied.status, body.idempotencyKey]
      );
      await client.query(
        `update invoices set paid_paise = $1, status = $2, last_payment_at = now() where id = $3`,
        [applied.paidPaise, applied.status, body.invoiceId]
      );
      if (applied.overpaidPaise > 0 && inv.student_id) {
        await client.query(
          `insert into wallet_ledger (organization_id, student_id, type, credits, paise, reason, invoice_id, by, at)
           values ($1, $2, 'credit_currency', 0, $3, 'overpayment', $4, $5, now())`,
          [orgId, inv.student_id, applied.overpaidPaise, body.invoiceId, req.user.id]
        );
      }
      return { duplicate: false, status: applied.status };
    });
    if (!outcome.duplicate) {
      await writeAudit(orgId, req.user.id, "payment.record_manual", "invoices", body.invoiceId, {
        amountPaise: body.amountPaise,
        method: body.method
      });
    }
    res.status(outcome.duplicate ? 200 : 201).json({ ok: true, invoiceStatus: outcome.status, duplicate: outcome.duplicate });
  } catch (err) {
    next(err);
  }
});
router3.post("/invoices/:invoiceId/void", requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const { data: inv, error } = await supabaseAdmin.from("invoices").select("organization_id, status").eq("id", req.params.invoiceId).maybeSingle();
    if (error) throw error;
    if (!inv || inv.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Invoice not found" } });
    }
    if (inv.status === "paid") {
      return res.status(422).json({ error: { code: "already_paid", message: "Paid invoices cannot be voided; issue a refund instead" } });
    }
    const { error: updErr } = await supabaseAdmin.from("invoices").update({ status: "void", voided_at: (/* @__PURE__ */ new Date()).toISOString(), voided_by: req.user.id }).eq("id", req.params.invoiceId);
    if (updErr) throw updErr;
    await writeAudit(orgId, req.user.id, "invoice.void", "invoices", req.params.invoiceId, {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
router3.post("/invoices/:invoiceId/finalize", requireRole(...CAN_MONEY), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const { data: gw } = await supabaseAdmin.from("payment_gateways").select("tax").eq("organization_id", orgId).maybeSingle();
    const tax = gw?.tax || {};
    const slug = tax.invoicePrefix || orgId.slice(0, 6);
    const out = await withTransaction(async (client) => {
      const invRes = await client.query(
        `select organization_id, status, invoice_number from invoices where id = $1 for update`,
        [req.params.invoiceId]
      );
      if (invRes.rowCount === 0 || invRes.rows[0].organization_id !== orgId) {
        throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
      }
      const inv = invRes.rows[0];
      if (inv.status === "void") {
        throw Object.assign(new Error("Invoice is void"), { status: 422, code: "invoice_void" });
      }
      if (inv.invoice_number) {
        return { number: inv.invoice_number, alreadyFinalized: true };
      }
      const { number } = await allocateInvoiceNumber(client, orgId, slug);
      await client.query(
        `update invoices set invoice_number = $1, status = case when status = 'draft' then 'sent' else status end,
           finalized_at = now(), finalized_by = $2, gst_snapshot = $3
         where id = $4`,
        [number, req.user.id, JSON.stringify({
          legalName: tax.legalName || null,
          gstin: tax.gstin || null,
          placeOfSupply: tax.placeOfSupply || null
        }), req.params.invoiceId]
      );
      return { number, alreadyFinalized: false };
    });
    if (!out.alreadyFinalized) {
      await writeAudit(orgId, req.user.id, "invoice.finalize", "invoices", req.params.invoiceId, { number: out.number });
    }
    res.json({ ok: true, invoiceNumber: out.number });
  } catch (err) {
    next(err);
  }
});
async function resolveInvoicePaymentLink(orgId, invoiceId) {
  const { data: inv, error } = await supabaseAdmin.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (error) throw error;
  if (!inv || inv.organization_id !== orgId) {
    throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
  }
  if (inv.status === "void" || inv.status === "paid") {
    throw Object.assign(new Error(`Invoice is ${inv.status}`), { status: 422, code: "not_payable" });
  }
  const existing = inv.payment_link;
  if (existing?.shortUrl && ["created", "issued", "partially_paid"].includes(existing.status)) {
    return { shortUrl: existing.shortUrl, reused: true };
  }
  const creds = await getGatewayCreds(orgId);
  if (!creds) {
    throw Object.assign(new Error("Connect Razorpay in settings first"), { status: 422, code: "gateway_not_connected" });
  }
  const outstanding = inv.total_paise - (inv.paid_paise || 0);
  if (outstanding <= 0) {
    throw Object.assign(new Error("Invoice has no outstanding balance"), { status: 422, code: "nothing_due" });
  }
  let customer = {};
  if (inv.student_id) {
    const { data: st } = await supabaseAdmin.from("students").select("name, parent_phone, phone, parent_email, email").eq("id", inv.student_id).maybeSingle();
    if (st) {
      customer = { name: st.name || void 0, contact: st.parent_phone || st.phone || void 0, email: st.parent_email || st.email || void 0 };
    }
  }
  const items = inv.items || [];
  const link = await createPaymentLink(creds, {
    amountPaise: outstanding,
    referenceId: invoiceId,
    description: `${inv.invoice_number || "Invoice"} \xB7 ${items[0]?.description || "Tuition fees"}`,
    customer,
    notes: { organizationId: orgId, invoiceId },
    callbackUrl: process.env.APP_URL ? `${process.env.APP_URL}/app/invoices` : void 0
  });
  const { error: updErr } = await supabaseAdmin.from("invoices").update({
    payment_link: { id: link.id, shortUrl: link.shortUrl, status: link.status, amountPaise: outstanding, createdAt: (/* @__PURE__ */ new Date()).toISOString() }
  }).eq("id", invoiceId);
  if (updErr) throw updErr;
  return { shortUrl: link.shortUrl, reused: false, linkId: link.id, amountPaise: outstanding };
}
router3.post("/invoices/:invoiceId/payment-link", requireRole(...CAN_MONEY), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const result = await resolveInvoicePaymentLink(orgId, req.params.invoiceId);
    if (!result.reused) {
      await writeAudit(orgId, req.user.id, "invoice.payment_link", "invoices", req.params.invoiceId, {
        linkId: result.linkId,
        amountPaise: result.amountPaise
      });
    }
    res.json({ ok: true, shortUrl: result.shortUrl, reused: result.reused });
  } catch (err) {
    next(err);
  }
});
router3.post("/invoices/:invoiceId/pay", async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    if (req.user.role !== "parent") {
      return res.status(403).json({ error: { code: "forbidden", message: "This endpoint is for parent accounts" } });
    }
    const { data: inv, error } = await supabaseAdmin.from("invoices").select("organization_id, student_id").eq("id", req.params.invoiceId).maybeSingle();
    if (error) throw error;
    if (!inv || inv.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Invoice not found" } });
    }
    const { data: link } = await supabaseAdmin.from("parent_links").select("parent_user_id").eq("parent_user_id", req.user.id).eq("student_id", inv.student_id).maybeSingle();
    if (!link) {
      return res.status(403).json({ error: { code: "forbidden", message: "Not linked to this student" } });
    }
    const result = await resolveInvoicePaymentLink(orgId, req.params.invoiceId);
    if (!result.reused) {
      await writeAudit(orgId, req.user.id, "invoice.payment_link.parent", "invoices", req.params.invoiceId, {
        linkId: result.linkId,
        amountPaise: result.amountPaise
      });
    }
    res.json({ ok: true, shortUrl: result.shortUrl, reused: result.reused });
  } catch (err) {
    next(err);
  }
});
router3.get("/invoices/:invoiceId/pdf", async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const role = req.user.role;
    const STAFF_ROLES = /* @__PURE__ */ new Set(["owner", "admin", "tutor", "frontdesk", "accountant"]);
    const { data: inv, error } = await supabaseAdmin.from("invoices").select("*").eq("id", req.params.invoiceId).maybeSingle();
    if (error) throw error;
    if (!inv || inv.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Invoice not found" } });
    }
    if (role === "parent") {
      const { data: link } = await supabaseAdmin.from("parent_links").select("parent_user_id").eq("parent_user_id", req.user.id).eq("student_id", inv.student_id).maybeSingle();
      if (!link) {
        return res.status(403).json({ error: { code: "forbidden", message: "Not linked to this student" } });
      }
    } else if (role === "tutor") {
      if (inv.tutor_id !== req.user.id) {
        return res.status(403).json({ error: { code: "forbidden", message: "Tutors can only download their own invoices" } });
      }
    } else if (!STAFF_ROLES.has(role || "")) {
      return res.status(403).json({ error: { code: "forbidden", message: "No access to invoice PDF" } });
    }
    const [{ data: org }, { data: gw }, { data: student }] = await Promise.all([
      supabaseAdmin.from("organizations").select("*").eq("id", orgId).maybeSingle(),
      supabaseAdmin.from("payment_gateways").select("tax").eq("organization_id", orgId).maybeSingle(),
      inv.student_id ? supabaseAdmin.from("students").select("*").eq("id", inv.student_id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    const tax = gw?.tax || {};
    const pdf = renderInvoicePdf({
      invoice: {
        invoiceNumber: inv.invoice_number || null,
        status: inv.status,
        createdAt: new Date(inv.created_at),
        dueDate: inv.due_date || null,
        subtotalPaise: inv.subtotal_paise ?? null,
        taxPaise: inv.tax_paise ?? null,
        discountPaise: inv.discount_paise ?? null,
        totalPaise: inv.total_paise ?? null,
        paidPaise: inv.paid_paise ?? null,
        items: inv.items || null,
        gstSnapshot: inv.gst_snapshot || null,
        totalAmount: inv.total_amount ?? null,
        subtotal: inv.subtotal ?? null
      },
      org: {
        name: tax.legalName || org?.name || "Tuition Center",
        address: org?.address || null,
        phone: org?.phone || null,
        email: org?.email || null,
        gstin: tax.gstin || null
      },
      student: {
        name: student?.name || null,
        parentName: student?.parent_name || null,
        parentPhone: student?.parent_phone || null,
        parentEmail: student?.parent_email || null,
        address: student?.address || null
      }
    });
    const filename = `${inv.invoice_number || "invoice-" + req.params.invoiceId}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(pdf.byteLength));
    res.setHeader("Cache-Control", "private, no-store");
    res.end(pdf);
  } catch (err) {
    next(err);
  }
});
router3.post("/refunds", requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const body = refundRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const outcome = await withTransaction(async (client) => {
      const existing = await client.query(
        `select invoice_status from refunds where organization_id = $1 and idempotency_key = $2`,
        [orgId, body.idempotencyKey]
      );
      if ((existing.rowCount ?? 0) > 0) {
        return { duplicate: true, status: existing.rows[0].invoice_status };
      }
      const invRes = await client.query(
        `select organization_id, student_id, paid_paise, total_paise from invoices where id = $1 for update`,
        [body.invoiceId]
      );
      if (invRes.rowCount === 0 || invRes.rows[0].organization_id !== orgId) {
        throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
      }
      const inv = invRes.rows[0];
      const paid = inv.paid_paise || 0;
      if (body.amountPaise > paid) {
        throw Object.assign(new Error("Refund exceeds amount paid"), { status: 422, code: "refund_too_large" });
      }
      const newPaid = paid - body.amountPaise;
      const status = newPaid <= 0 ? "unpaid" : newPaid >= inv.total_paise ? "paid" : "partially_paid";
      await client.query(
        `insert into refunds (organization_id, invoice_id, student_id, amount_paise, reason, refunded_by, invoice_status, idempotency_key, at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [orgId, body.invoiceId, inv.student_id, body.amountPaise, body.reason || null, req.user.id, status, body.idempotencyKey]
      );
      await client.query(
        `update invoices set paid_paise = $1, status = $2, last_refund_at = now() where id = $3`,
        [newPaid, status, body.invoiceId]
      );
      return { duplicate: false, status };
    });
    if (!outcome.duplicate) {
      await writeAudit(orgId, req.user.id, "payment.refund", "invoices", body.invoiceId, { amountPaise: body.amountPaise });
    }
    res.status(outcome.duplicate ? 200 : 201).json({ ok: true, invoiceStatus: outcome.status, duplicate: outcome.duplicate });
  } catch (err) {
    next(err);
  }
});
router3.post("/reconcile", requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const creds = await getGatewayCreds(orgId);
    if (!creds) return res.status(422).json({ error: { code: "gateway_not_connected", message: "Connect Razorpay first" } });
    const openRes = await pool.query(
      `select id, payment_link from invoices
       where organization_id = $1 and status in ('sent','unpaid','partially_paid')
         and payment_link ->> 'id' is not null
       limit 100`,
      [orgId]
    );
    const RECONCILE_FETCH_CONCURRENCY = 6;
    const candidates = [];
    const queue = [...openRes.rows];
    await Promise.all(
      Array.from({ length: Math.min(RECONCILE_FETCH_CONCURRENCY, queue.length) }, async () => {
        for (let row = queue.shift(); row; row = queue.shift()) {
          const linkId = row.payment_link?.id;
          if (!linkId) continue;
          const link = await fetchPaymentLink(creds, linkId).catch(() => null);
          if (!link || link.status !== "paid") continue;
          const amountPaid = Number(link.amount_paid || 0);
          if (amountPaid <= 0) continue;
          candidates.push({ id: row.id, linkId, amountPaid });
        }
      })
    );
    let reconciled = 0;
    for (const row of candidates) {
      const { linkId, amountPaid } = row;
      const idempotencyKey = `rzp_link_${linkId}`;
      const settled = await withTransaction(async (client) => {
        const existing = await client.query(
          `select 1 from payments where organization_id = $1 and idempotency_key = $2`,
          [orgId, idempotencyKey]
        );
        if ((existing.rowCount ?? 0) > 0) return false;
        const invRes = await client.query(
          `select student_id, status, total_paise, paid_paise from invoices where id = $1 for update`,
          [row.id]
        );
        const inv = invRes.rows[0];
        const applied = applyPayment(
          { status: inv.status, totalPaise: inv.total_paise, paidPaise: inv.paid_paise },
          amountPaid
        );
        await client.query(
          `insert into payments (organization_id, invoice_id, student_id, amount_paise, method, gateway, gateway_link_id, source, invoice_status, idempotency_key, at)
           values ($1, $2, $3, $4, 'upi', 'razorpay', $5, 'reconcile', $6, $7, now())`,
          [orgId, row.id, inv.student_id, amountPaid, linkId, applied.status, idempotencyKey]
        );
        await client.query(
          `update invoices set paid_paise = $1, status = $2, last_payment_at = now() where id = $3`,
          [applied.paidPaise, applied.status, row.id]
        );
        return true;
      });
      if (settled) {
        reconciled++;
        await writeAudit(orgId, req.user.id, "payment.reconciled", "invoices", row.id, { linkId, amountPaise: amountPaid });
      }
    }
    res.json({ ok: true, scanned: openRes.rowCount, reconciled });
  } catch (err) {
    next(err);
  }
});
var billing_default = router3;

// server/routes/gateway.ts
import express4 from "express";

// shared/schemas/gateway.ts
import { z as z3 } from "zod";
var gatewayCredsRequestSchema = z3.object({
  keyId: z3.string().min(6),
  keySecret: z3.string().min(6),
  webhookSecret: z3.string().min(6)
});
var gatewayTaxRequestSchema = z3.object({
  legalName: z3.string().max(200).optional(),
  gstin: z3.string().max(20).optional(),
  addressLines: z3.array(z3.string().max(200)).max(5).optional(),
  placeOfSupply: z3.string().max(60).optional(),
  defaultTaxRatePercent: z3.number().min(0).max(28).optional(),
  invoicePrefix: z3.string().max(8).optional()
});

// server/routes/gateway.ts
var router4 = express4.Router();
router4.use(authenticateToken, requireOrg);
var CAN_CONFIG = ["owner", "admin"];
router4.get("/", requireRole(...CAN_CONFIG), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const { data, error } = await supabaseAdmin.from("payment_gateways").select("key_id, key_secret_enc, webhook_secret_enc, tax").eq("organization_id", orgId).maybeSingle();
    if (error) throw error;
    const d = data || {};
    res.json({
      connected: Boolean(d.key_id && d.key_secret_enc && d.webhook_secret_enc),
      keyId: d.key_id || null,
      tax: d.tax || null
    });
  } catch (err) {
    next(err);
  }
});
router4.put("/razorpay", requireRole(...CAN_CONFIG), async (req, res, next) => {
  try {
    const { keyId, keySecret, webhookSecret } = gatewayCredsRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const { error } = await supabaseAdmin.from("payment_gateways").upsert({
      organization_id: orgId,
      key_id: keyId,
      key_secret_enc: encrypt(keySecret),
      webhook_secret_enc: encrypt(webhookSecret),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (error) throw error;
    await writeAudit(orgId, req.user.id, "gateway.connect", "payment_gateways", orgId, { provider: "razorpay", keyId });
    res.json({ ok: true, connected: true, keyId });
  } catch (err) {
    next(err);
  }
});
router4.delete("/razorpay", requireRole(...CAN_CONFIG), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const { error } = await supabaseAdmin.from("payment_gateways").upsert({
      organization_id: orgId,
      key_id: null,
      key_secret_enc: null,
      webhook_secret_enc: null,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (error) throw error;
    await writeAudit(orgId, req.user.id, "gateway.disconnect", "payment_gateways", orgId, {});
    res.json({ ok: true, connected: false });
  } catch (err) {
    next(err);
  }
});
router4.put("/tax", requireRole(...CAN_CONFIG), async (req, res, next) => {
  try {
    const tax = gatewayTaxRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const { error } = await supabaseAdmin.from("payment_gateways").upsert({
      organization_id: orgId,
      tax
    });
    if (error) throw error;
    await writeAudit(orgId, req.user.id, "gateway.tax_update", "payment_gateways", orgId, { gstin: tax.gstin || null });
    res.json({ ok: true, tax });
  } catch (err) {
    next(err);
  }
});
var gateway_default = router4;

// server/routes/parents.ts
import express5 from "express";
import crypto4 from "node:crypto";

// shared/schemas/parents.ts
import { z as z4 } from "zod";
var parentInviteRequestSchema = z4.object({ studentId: z4.string().uuid() });
var parentRedeemRequestSchema = z4.object({
  token: z4.string().min(10),
  consent: z4.literal(true)
});

// server/routes/parents.ts
var router5 = express5.Router();
router5.use(authenticateToken);
var STAFF_WHO_CAN_INVITE = ["owner", "admin", "frontdesk"];
var INVITE_TTL_MS2 = 7 * 24 * 3600 * 1e3;
router5.post("/invites", async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: { code: "no_organization", message: "User does not belong to an organization" } });
    }
    if (!req.user.role || !STAFF_WHO_CAN_INVITE.includes(req.user.role)) {
      return res.status(403).json({ error: { code: "forbidden", message: "Insufficient role" } });
    }
    const { studentId } = parentInviteRequestSchema.parse(req.body);
    const { data: student, error: studentErr } = await supabaseAdmin.from("students").select("name, organization_id").eq("id", studentId).maybeSingle();
    if (studentErr) throw studentErr;
    if (!student || student.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Student not found" } });
    }
    const token = crypto4.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS2);
    const { error: inviteErr } = await supabaseAdmin.from("parent_invites").insert({
      token,
      organization_id: orgId,
      student_id: studentId,
      expires_at: expiresAt.toISOString()
    });
    if (inviteErr) throw inviteErr;
    await writeAudit(orgId, req.user.id, "parent_invite.create", "students", studentId, { token: token.slice(0, 8) + "\u2026" });
    res.status(201).json({ ok: true, token, expiresAt: expiresAt.toISOString(), studentName: student.name || null });
  } catch (err) {
    next(err);
  }
});
async function loadInvite(token) {
  const { data: invite, error } = await supabaseAdmin.from("parent_invites").select("*").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!invite) {
    throw Object.assign(new Error("Invite not found"), { status: 404, code: "not_found" });
  }
  if (invite.used_at) {
    throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error("Invite expired"), { status: 410, code: "invite_expired" });
  }
  return invite;
}
router5.get("/invites/:token/preview", async (req, res, next) => {
  try {
    const invite = await loadInvite(req.params.token);
    const [{ data: student }, { data: org }] = await Promise.all([
      supabaseAdmin.from("students").select("name").eq("id", invite.student_id).maybeSingle(),
      supabaseAdmin.from("organizations").select("name").eq("id", invite.organization_id).maybeSingle()
    ]);
    res.json({
      ok: true,
      studentName: student?.name || null,
      organizationName: org?.name || null
    });
  } catch (err) {
    next(err);
  }
});
router5.post("/redeem", async (req, res, next) => {
  try {
    const body = parentRedeemRequestSchema.parse(req.body);
    const uid = req.user.id;
    const invite = await loadInvite(body.token);
    if (req.user.organizationId && req.user.organizationId !== invite.organization_id) {
      return res.status(409).json({ error: { code: "org_conflict", message: "Account is already linked to a different organization" } });
    }
    await withTransaction(async (client) => {
      const freshInvite = await client.query(`select used_at from parent_invites where token = $1 for update`, [body.token]);
      if (freshInvite.rows[0]?.used_at) {
        throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
      }
      await client.query(
        `insert into parent_links (parent_user_id, student_id, organization_id)
         values ($1, $2, $3) on conflict (parent_user_id, student_id) do nothing`,
        [uid, invite.student_id, invite.organization_id]
      );
      await client.query(
        `update parent_invites set used_at = now(), used_by = $1 where token = $2`,
        [uid, body.token]
      );
      await client.query(
        `update class_sessions
         set parent_user_ids = array_append(parent_user_ids, $1)
         where organization_id = $2 and $3 = any(student_ids) and not ($1 = any(parent_user_ids))`,
        [uid, invite.organization_id, invite.student_id]
      );
    });
    await setMembership(invite.organization_id, uid, "parent", uid);
    await writeAudit(invite.organization_id, uid, "parent_invite.redeem", "parent_links", `${uid}_${invite.student_id}`, {
      studentId: invite.student_id
    });
    res.json({ ok: true, organizationId: invite.organization_id, studentId: invite.student_id });
  } catch (err) {
    next(err);
  }
});
var parents_default = router5;

// server/routes/students.ts
import express6 from "express";
import crypto5 from "node:crypto";

// shared/schemas/students.ts
import { z as z5 } from "zod";
var studentInviteRequestSchema = z5.object({ studentId: z5.string().uuid() });
var studentRedeemRequestSchema = z5.object({ token: z5.string().min(10) });

// server/routes/students.ts
var router6 = express6.Router();
router6.use(authenticateToken);
var STAFF_WHO_CAN_INVITE2 = ["owner", "admin", "frontdesk"];
var INVITE_TTL_MS3 = 7 * 24 * 3600 * 1e3;
router6.post("/invites", async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: { code: "no_organization", message: "User does not belong to an organization" } });
    }
    if (!req.user.role || !STAFF_WHO_CAN_INVITE2.includes(req.user.role)) {
      return res.status(403).json({ error: { code: "forbidden", message: "Insufficient role" } });
    }
    const { studentId } = studentInviteRequestSchema.parse(req.body);
    const { data: student, error: studentErr } = await supabaseAdmin.from("students").select("name, organization_id, student_user_id").eq("id", studentId).maybeSingle();
    if (studentErr) throw studentErr;
    if (!student || student.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Student not found" } });
    }
    if (student.student_user_id) {
      return res.status(409).json({ error: { code: "already_linked", message: "This student already has a portal account linked" } });
    }
    const token = crypto5.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS3);
    const { error: inviteErr } = await supabaseAdmin.from("student_invites").insert({
      token,
      organization_id: orgId,
      student_id: studentId,
      expires_at: expiresAt.toISOString()
    });
    if (inviteErr) throw inviteErr;
    await writeAudit(orgId, req.user.id, "student_invite.create", "students", studentId, { token: token.slice(0, 8) + "\u2026" });
    res.status(201).json({ ok: true, token, expiresAt: expiresAt.toISOString(), studentName: student.name || null });
  } catch (err) {
    next(err);
  }
});
async function loadInvite2(token) {
  const { data: invite, error } = await supabaseAdmin.from("student_invites").select("*").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!invite) {
    throw Object.assign(new Error("Invite not found"), { status: 404, code: "not_found" });
  }
  if (invite.used_at) {
    throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error("Invite expired"), { status: 410, code: "invite_expired" });
  }
  return invite;
}
router6.get("/invites/:token/preview", async (req, res, next) => {
  try {
    const invite = await loadInvite2(req.params.token);
    const [{ data: student }, { data: org }] = await Promise.all([
      supabaseAdmin.from("students").select("name").eq("id", invite.student_id).maybeSingle(),
      supabaseAdmin.from("organizations").select("name").eq("id", invite.organization_id).maybeSingle()
    ]);
    res.json({
      ok: true,
      studentName: student?.name || null,
      organizationName: org?.name || null
    });
  } catch (err) {
    next(err);
  }
});
router6.post("/redeem", async (req, res, next) => {
  try {
    const body = studentRedeemRequestSchema.parse(req.body);
    const uid = req.user.id;
    const invite = await loadInvite2(body.token);
    if (req.user.organizationId && req.user.organizationId !== invite.organization_id) {
      return res.status(409).json({ error: { code: "org_conflict", message: "Account is already linked to a different organization" } });
    }
    await withTransaction(async (client) => {
      const freshInvite = await client.query(`select used_at from student_invites where token = $1 for update`, [body.token]);
      if (freshInvite.rows[0]?.used_at) {
        throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
      }
      const claim = await client.query(
        `update students set student_user_id = $1 where id = $2 and student_user_id is null`,
        [uid, invite.student_id]
      );
      if (claim.rowCount === 0) {
        throw Object.assign(new Error("This student already has a portal account linked"), { status: 409, code: "already_linked" });
      }
      await client.query(
        `update student_invites set used_at = now(), used_by = $1 where token = $2`,
        [uid, body.token]
      );
      await client.query(
        `update class_sessions
         set student_user_ids = array_append(student_user_ids, $1)
         where organization_id = $2 and $3 = any(student_ids) and not ($1 = any(student_user_ids))`,
        [uid, invite.organization_id, invite.student_id]
      );
    });
    await setMembership(invite.organization_id, uid, "student", uid);
    await writeAudit(invite.organization_id, uid, "student_invite.redeem", "students", invite.student_id, {});
    res.json({ ok: true, organizationId: invite.organization_id, studentId: invite.student_id });
  } catch (err) {
    next(err);
  }
});
var students_default = router6;

// server/routes/webhooks.ts
import express7 from "express";

// shared/plans.ts
var PLAN_IDS = ["free", "growth", "scale"];
var PLAN_CATALOG = {
  free: {
    id: "free",
    name: "Free",
    studentLimit: 15,
    pricePaise: 0,
    tagline: "Up to 15 active students"
  },
  growth: {
    id: "growth",
    name: "Growth",
    studentLimit: 60,
    pricePaise: 149900,
    // ₹1,499/mo
    tagline: "Up to 60 active students"
  },
  scale: {
    id: "scale",
    name: "Scale",
    studentLimit: null,
    pricePaise: 399900,
    // ₹3,999/mo
    tagline: "Unlimited students"
  }
};
function isPlanId(value) {
  return PLAN_IDS.includes(value);
}

// server/routes/webhooks.ts
var router7 = express7.Router();
var RAZORPAY_WEBHOOK = { system: "razorpay_webhook" };
router7.post("/razorpay/:orgId", async (req, res) => {
  const orgId = req.params.orgId;
  const signature = req.header("x-razorpay-signature") || "";
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  try {
    const creds = await getGatewayCreds(orgId);
    if (!creds) return res.status(404).json({ error: { code: "not_connected", message: "Gateway not configured" } });
    if (!verifyWebhookSignature(rawBody, signature, creds.webhookSecret)) {
      return res.status(400).json({ error: { code: "bad_signature", message: "Signature verification failed" } });
    }
    const event = JSON.parse(rawBody);
    const outcome = await handleEvent(orgId, event);
    return res.json({ ok: true, ...outcome });
  } catch (err) {
    req.log?.error?.({ err }, "Razorpay webhook processing failed");
    return res.status(500).json({ error: { code: "internal", message: "Webhook processing failed" } });
  }
});
router7.post("/razorpay-platform", async (req, res) => {
  const secret = process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET;
  const signature = req.header("x-razorpay-signature") || "";
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (!secret) {
    return res.status(503).json({ error: { code: "not_configured", message: "Platform billing not yet wired" } });
  }
  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return res.status(400).json({ error: { code: "bad_signature", message: "Signature verification failed" } });
  }
  try {
    const event = JSON.parse(rawBody);
    const outcome = await handlePlatformSubscriptionEvent(event);
    return res.json({ ok: true, ...outcome });
  } catch (err) {
    req.log?.error?.({ err }, "Platform subscription webhook processing failed");
    return res.status(500).json({ error: { code: "internal", message: "Webhook processing failed" } });
  }
});
async function handlePlatformSubscriptionEvent(event) {
  const type = event?.event;
  const sub = event?.payload?.subscription?.entity;
  if (!sub) return { ignored: true, reason: "no_subscription_entity" };
  const orgId = sub?.notes?.organizationId;
  const targetPlanRaw = sub?.notes?.targetPlan;
  if (!orgId) return { ignored: true, reason: "no_organization_id_in_notes" };
  if (type === "subscription.activated" || type === "subscription.charged") {
    const plan = targetPlanRaw && isPlanId(targetPlanRaw) ? targetPlanRaw : "free";
    const def = PLAN_CATALOG[plan];
    const currentEnd = sub.current_end ? new Date(sub.current_end * 1e3).toISOString() : null;
    const { error } = await supabaseAdmin.from("subscriptions").update({
      plan,
      status: "active",
      student_limit: def.studentLimit,
      price_paise: def.pricePaise,
      current_period_end: currentEnd,
      razorpay_subscription_id: sub.id,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("organization_id", orgId);
    if (error) throw error;
    await writeAudit(orgId, RAZORPAY_WEBHOOK, "subscription.plan_changed", "subscriptions", orgId, { plan, event: type });
    return { plan, status: "active" };
  }
  if (type === "subscription.cancelled" || type === "subscription.completed" || type === "subscription.halted") {
    const free = PLAN_CATALOG.free;
    const { error } = await supabaseAdmin.from("subscriptions").update({
      plan: "free",
      status: "cancelled",
      student_limit: free.studentLimit,
      price_paise: free.pricePaise,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("organization_id", orgId);
    if (error) throw error;
    await writeAudit(orgId, RAZORPAY_WEBHOOK, "subscription.cancelled", "subscriptions", orgId, { event: type });
    return { status: "cancelled" };
  }
  return { ignored: true, reason: "unhandled_event_type" };
}
async function handleEvent(orgId, event) {
  const type = event?.event;
  const linkEntity = event?.payload?.payment_link?.entity;
  const paymentEntity = event?.payload?.payment?.entity;
  if (type !== "payment_link.paid" && type !== "payment.captured") {
    return { ignored: true, type };
  }
  if (!paymentEntity?.id) return { ignored: true, reason: "no_payment" };
  const invoiceId = linkEntity?.reference_id || linkEntity?.notes?.invoiceId || paymentEntity?.notes?.invoiceId;
  if (!invoiceId) return { ignored: true, reason: "no_invoice_ref" };
  const amountPaise = Number(paymentEntity.amount);
  const paymentId = String(paymentEntity.id);
  const idempotencyKey = `rzp_${paymentId}`;
  const result = await withTransaction(async (client) => {
    const existing = await client.query(
      `select invoice_status from payments where organization_id = $1 and idempotency_key = $2`,
      [orgId, idempotencyKey]
    );
    if ((existing.rowCount ?? 0) > 0) {
      return { duplicate: true, status: existing.rows[0].invoice_status };
    }
    const invRes = await client.query(
      `select organization_id, student_id, status, total_paise, paid_paise from invoices where id = $1 for update`,
      [invoiceId]
    );
    if (invRes.rowCount === 0 || invRes.rows[0].organization_id !== orgId) {
      return { orphan: true };
    }
    const inv = invRes.rows[0];
    const applied = applyPayment(
      { status: inv.status, totalPaise: inv.total_paise, paidPaise: inv.paid_paise },
      amountPaise
    );
    await client.query(
      `insert into payments
         (organization_id, invoice_id, student_id, amount_paise, method, gateway, gateway_payment_id, gateway_link_id, invoice_status, idempotency_key, at)
       values ($1, $2, $3, $4, 'upi', 'razorpay', $5, $6, $7, $8, now())`,
      [orgId, invoiceId, inv.student_id, amountPaise, paymentId, linkEntity?.id || null, applied.status, idempotencyKey]
    );
    await client.query(
      `update invoices set paid_paise = $1, status = $2, last_payment_at = now() where id = $3`,
      [applied.paidPaise, applied.status, invoiceId]
    );
    if (applied.overpaidPaise > 0 && inv.student_id) {
      await client.query(
        `insert into wallet_ledger (organization_id, student_id, type, credits, paise, reason, invoice_id, gateway_payment_id, by, at)
         values ($1, $2, 'credit_currency', 0, $3, 'overpayment', $4, $5, 'razorpay_webhook', now())`,
        [orgId, inv.student_id, applied.overpaidPaise, invoiceId, paymentId]
      );
    }
    return { duplicate: false, status: applied.status, overpaidPaise: applied.overpaidPaise };
  });
  if (result.orphan) return { ignored: true, reason: "invoice_not_found" };
  if (!result.duplicate) {
    await writeAudit(orgId, RAZORPAY_WEBHOOK, "payment.gateway_captured", "invoices", invoiceId, {
      gatewayPaymentId: paymentId,
      amountPaise,
      invoiceStatus: result.status
    });
  }
  return result;
}
var webhooks_default = router7;

// server/routes/scheduling.ts
import express8 from "express";

// shared/schemas/scheduling.ts
import { z as z6 } from "zod";
var enrollRequestSchema = z6.object({
  studentId: z6.string().uuid(),
  templateId: z6.string().uuid()
});
var enrollResponseSchema = z6.object({ ok: z6.literal(true), enrollmentId: z6.string().uuid() });
var createSessionRequestSchema = z6.object({
  templateId: z6.string().uuid(),
  tutorId: z6.string().uuid(),
  studentIds: z6.array(z6.string().uuid()).optional(),
  startTime: z6.string().min(1),
  endTime: z6.string().min(1),
  isOnline: z6.boolean().optional(),
  roomNumber: z6.string().optional()
});
var createSessionResponseSchema = z6.object({ ok: z6.literal(true), sessionId: z6.string().uuid() });
var materializeResponseSchema = z6.object({
  ok: z6.literal(true),
  created: z6.array(z6.string()),
  conflicts: z6.array(z6.object({ templateId: z6.string().uuid(), date: z6.string() }))
});
var rescheduleSessionRequestSchema = z6.object({
  startTime: z6.string().min(1),
  endTime: z6.string().min(1)
});
var rescheduleSessionResponseSchema = z6.object({ ok: z6.literal(true), sessionId: z6.string().uuid() });
var updateTemplateScopeSchema = z6.object({
  scope: z6.enum(["future", "all"]),
  daysOfWeek: z6.array(z6.number().int().min(0).max(6)).optional(),
  startHour: z6.number().int().min(0).max(23).optional(),
  startMinute: z6.number().int().min(0).max(59).optional(),
  durationMinutes: z6.number().int().positive().optional()
});
var updateTemplateScopeResponseSchema = z6.object({
  ok: z6.literal(true),
  created: z6.array(z6.string()),
  conflicts: z6.array(z6.object({ templateId: z6.string().uuid(), date: z6.string() }))
});
var findGapsQuerySchema = z6.object({
  tutorId: z6.string().uuid(),
  durationMinutes: z6.coerce.number().int().positive(),
  templateId: z6.string().uuid().optional()
});
var findGapsResponseSchema = z6.object({
  ok: z6.literal(true),
  slots: z6.array(z6.object({ start: z6.string(), end: z6.string() }))
});

// server/routes/scheduling.ts
var router8 = express8.Router();
router8.use(authenticateToken, requireOrg);
var CAN_SCHEDULE = ["owner", "admin", "tutor", "frontdesk"];
router8.post("/enrollments", requireRole(...CAN_SCHEDULE), async (req, res, next) => {
  try {
    const { studentId, templateId } = enrollRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const enrollmentId = await withTransaction(async (client) => {
      const templateRes = await client.query(
        `select organization_id, type, capacity from class_templates where id = $1 for update`,
        [templateId]
      );
      if (templateRes.rowCount === 0) {
        throw Object.assign(new Error("Class template not found"), { status: 404, code: "not_found" });
      }
      const template = templateRes.rows[0];
      if (template.organization_id !== orgId) {
        throw Object.assign(new Error("Template belongs to another organization"), { status: 403, code: "forbidden" });
      }
      if (template.type === "BATCH") {
        const countRes = await client.query(
          `select count(*)::int as n from enrollments where template_id = $1 and status = 'active'`,
          [templateId]
        );
        if (countRes.rows[0].n >= template.capacity) {
          throw Object.assign(
            new Error(`Cannot enroll: ${template.type} is at max capacity (${template.capacity})`),
            { status: 409, code: "capacity_full" }
          );
        }
      }
      const insertRes = await client.query(
        `insert into enrollments (organization_id, student_id, template_id, status)
         values ($1, $2, $3, 'active') returning id`,
        [orgId, studentId, templateId]
      );
      return insertRes.rows[0].id;
    });
    await writeAudit(orgId, req.user.id, "enrollment.create", "enrollments", enrollmentId, { studentId, templateId });
    res.json({ ok: true, enrollmentId });
  } catch (err) {
    next(err);
  }
});
async function resolveUserIds(client, studentIds) {
  if (studentIds.length === 0) return { studentUserIds: [], parentUserIds: [] };
  const { rows } = await client.query(
    `select 'student' as kind, student_user_id as user_id
       from students where id = any($1::uuid[]) and student_user_id is not null
     union
     select 'parent', parent_user_id
       from parent_links where student_id = any($1::uuid[])`,
    [studentIds]
  );
  return {
    studentUserIds: rows.filter((r) => r.kind === "student").map((r) => r.user_id),
    parentUserIds: rows.filter((r) => r.kind === "parent").map((r) => r.user_id)
  };
}
async function lockTutorSchedule(client, orgId, tutorId) {
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${orgId}:${tutorId}`]);
}
async function assertNoTutorConflict(client, orgId, tutorId, startTime, endTime, excludeSessionId) {
  const conflict = await client.query(
    `select 1 from class_sessions
     where organization_id = $1 and tutor_id = $2 and status = 'scheduled'
       and start_time < $4::timestamptz and end_time > $3::timestamptz
       and ($5::uuid is null or id <> $5::uuid)
     limit 1`,
    [orgId, tutorId, startTime, endTime, excludeSessionId ?? null]
  );
  if (conflict.rowCount) {
    throw Object.assign(new Error("Tutor has a conflicting session at this time."), { status: 409, code: "conflict" });
  }
}
async function checkTutorConflictAndInsert(client, orgId, tutorId, startTime, endTime, insert, excludeSessionId) {
  await lockTutorSchedule(client, orgId, tutorId);
  await assertNoTutorConflict(client, orgId, tutorId, startTime, endTime, excludeSessionId);
  return insert();
}
router8.post("/sessions", requireRole(...CAN_SCHEDULE), async (req, res, next) => {
  try {
    const body = createSessionRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const sessionId = await withTransaction(
      (client) => checkTutorConflictAndInsert(client, orgId, body.tutorId, body.startTime, body.endTime, async () => {
        const studentIds = body.studentIds || [];
        const { studentUserIds, parentUserIds } = await resolveUserIds(client, studentIds);
        const insertRes = await client.query(
          `insert into class_sessions
             (organization_id, template_id, tutor_id, student_ids, student_user_ids, parent_user_ids, start_time, end_time, status, is_online, room_number)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9, $10)
           returning id`,
          [orgId, body.templateId, body.tutorId, studentIds, studentUserIds, parentUserIds, body.startTime, body.endTime, body.isOnline ?? false, body.roomNumber ?? null]
        );
        return insertRes.rows[0].id;
      })
    );
    res.json({ ok: true, sessionId });
  } catch (err) {
    next(err);
  }
});
router8.patch("/sessions/:id", requireRole(...CAN_SCHEDULE), async (req, res, next) => {
  try {
    const body = rescheduleSessionRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const sessionId = req.params.id;
    await withTransaction(async (client) => {
      const existing = await client.query(
        `select organization_id, tutor_id, status from class_sessions where id = $1`,
        [sessionId]
      );
      if (existing.rowCount === 0) {
        throw Object.assign(new Error("Session not found"), { status: 404, code: "not_found" });
      }
      const row = existing.rows[0];
      if (row.organization_id !== orgId) {
        throw Object.assign(new Error("Session belongs to another organization"), { status: 403, code: "forbidden" });
      }
      if (row.status === "completed") {
        throw Object.assign(new Error("Cannot reschedule a completed session"), { status: 409, code: "already_completed" });
      }
      await checkTutorConflictAndInsert(
        client,
        orgId,
        row.tutor_id,
        body.startTime,
        body.endTime,
        async () => {
          await client.query(
            `update class_sessions set start_time = $1, end_time = $2, updated_at = now() where id = $3`,
            [body.startTime, body.endTime, sessionId]
          );
          return sessionId;
        },
        sessionId
      );
    });
    await writeAudit(orgId, req.user.id, "session.reschedule", "class_sessions", sessionId, { startTime: body.startTime, endTime: body.endTime });
    res.json({ ok: true, sessionId });
  } catch (err) {
    next(err);
  }
});
var WEEKS_AHEAD = 8;
var TEMPLATE_SELECT = `select id, organization_id, type, tutor_id, student_ids, days_of_week,
    start_hour, start_minute, duration_minutes, is_online, room_number
  from class_templates`;
var MATERIALIZABLE = `type = 'BATCH' and tutor_id is not null and start_hour is not null
  and coalesce(array_length(days_of_week, 1), 0) > 0`;
function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
async function materializeTemplate(template) {
  const result = { created: [], conflicts: [] };
  const daysOfWeek = template.days_of_week || [];
  if (template.type !== "BATCH" || daysOfWeek.length === 0 || template.start_hour == null || !template.tutor_id) return result;
  const durationMinutes = template.duration_minutes ?? 60;
  const now = /* @__PURE__ */ new Date();
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + WEEKS_AHEAD * 7 * 24 * 3600 * 1e3);
  const candidates = [];
  for (let d = new Date(today); d <= horizon; d.setDate(d.getDate() + 1)) {
    if (!daysOfWeek.includes(d.getDay())) continue;
    const start = new Date(d);
    start.setHours(template.start_hour, template.start_minute ?? 0, 0, 0);
    if (start < now) continue;
    candidates.push({
      dateKey: localDateKey(start),
      start,
      end: new Date(start.getTime() + durationMinutes * 60 * 1e3)
    });
  }
  if (candidates.length === 0) return result;
  const orgId = template.organization_id;
  const tutorId = template.tutor_id;
  const windowStart = candidates[0].start.toISOString();
  const windowEnd = candidates[candidates.length - 1].end.toISOString();
  return withTransaction(async (client) => {
    await lockTutorSchedule(client, orgId, tutorId);
    const existingRes = await client.query(
      `select to_char(materialized_date, 'YYYY-MM-DD') as date_key
       from class_sessions
       where template_id = $1 and materialized_date = any($2::date[])`,
      [template.id, candidates.map((c) => c.dateKey)]
    );
    const alreadyMaterialized = new Set(existingRes.rows.map((r) => r.date_key));
    const busyRes = await client.query(
      `select start_time, end_time from class_sessions
       where organization_id = $1 and tutor_id = $2 and status = 'scheduled'
         and start_time < $4::timestamptz and end_time > $3::timestamptz`,
      [orgId, tutorId, windowStart, windowEnd]
    );
    const busy = busyRes.rows.map((r) => ({
      start: new Date(r.start_time).getTime(),
      end: new Date(r.end_time).getTime()
    }));
    const toInsert = [];
    for (const c of candidates) {
      if (alreadyMaterialized.has(c.dateKey)) continue;
      const start = c.start.getTime();
      const end = c.end.getTime();
      if (busy.some((b) => start < b.end && end > b.start)) {
        result.conflicts.push({ templateId: template.id, date: c.dateKey });
        continue;
      }
      busy.push({ start, end });
      toInsert.push(c);
    }
    if (toInsert.length === 0) return result;
    const studentIds = template.student_ids || [];
    const { studentUserIds, parentUserIds } = await resolveUserIds(client, studentIds);
    const insertRes = await client.query(
      `insert into class_sessions
         (organization_id, template_id, tutor_id, student_ids, student_user_ids, parent_user_ids,
          start_time, end_time, status, is_online, room_number, materialized_date)
       select $1, $2, $3, $4::uuid[], $5::uuid[], $6::uuid[],
              v.start_time, v.end_time, 'scheduled', $7, $8, v.materialized_date
       from unnest($9::timestamptz[], $10::timestamptz[], $11::date[])
            as v(start_time, end_time, materialized_date)
       on conflict (template_id, materialized_date) do nothing
       returning to_char(materialized_date, 'YYYY-MM-DD') as date_key`,
      [
        orgId,
        template.id,
        tutorId,
        studentIds,
        studentUserIds,
        parentUserIds,
        template.is_online ?? false,
        template.room_number ?? null,
        toInsert.map((c) => c.start.toISOString()),
        toInsert.map((c) => c.end.toISOString()),
        toInsert.map((c) => c.dateKey)
      ]
    );
    result.created.push(...insertRes.rows.map((r) => r.date_key));
    return result;
  });
}
router8.post("/materialize", requireRole(...CAN_SCHEDULE), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const templatesRes = await pool.query(
      `${TEMPLATE_SELECT} where organization_id = $1 and ${MATERIALIZABLE}`,
      [orgId]
    );
    const aggregate = { created: [], conflicts: [] };
    for (const row of templatesRes.rows) {
      const r = await materializeTemplate(row);
      aggregate.created.push(...r.created);
      aggregate.conflicts.push(...r.conflicts);
    }
    res.json({ ok: true, ...aggregate });
  } catch (err) {
    next(err);
  }
});
router8.patch("/templates/:id", requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const body = updateTemplateScopeSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const templateId = req.params.id;
    const templateRes = await pool.query(`${TEMPLATE_SELECT} where id = $1`, [templateId]);
    if (templateRes.rowCount === 0) {
      throw Object.assign(new Error("Class template not found"), { status: 404, code: "not_found" });
    }
    const existing = templateRes.rows[0];
    if (existing.organization_id !== orgId) {
      throw Object.assign(new Error("Template belongs to another organization"), { status: 403, code: "forbidden" });
    }
    const updateRes = await pool.query(
      `update class_templates set
         days_of_week = coalesce($1, days_of_week),
         start_hour = coalesce($2, start_hour),
         start_minute = coalesce($3, start_minute),
         duration_minutes = coalesce($4, duration_minutes)
       where id = $5
       returning id, organization_id, type, tutor_id, student_ids, days_of_week, start_hour, start_minute, duration_minutes, is_online, room_number`,
      [body.daysOfWeek ?? null, body.startHour ?? null, body.startMinute ?? null, body.durationMinutes ?? null, templateId]
    );
    const updated = updateRes.rows[0];
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    await pool.query(
      `delete from class_sessions
       where template_id = $1 and status = 'scheduled' and materialized_date >= $2`,
      [templateId, localDateKey(today)]
    );
    const result = await materializeTemplate(updated);
    await writeAudit(orgId, req.user.id, "template.update_scope", "class_templates", templateId, { scope: body.scope, ...result });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});
router8.get("/gaps", requireRole(...CAN_SCHEDULE), async (req, res, next) => {
  try {
    const query = findGapsQuerySchema.parse(req.query);
    const orgId = req.user.organizationId;
    const LOOKAHEAD_DAYS = 14;
    const MAX_SLOTS = 10;
    const availabilityRes = await pool.query(
      `select day_of_week, start_time, end_time from tutor_availability
       where organization_id = $1 and tutor_id = $2`,
      [orgId, query.tutorId]
    );
    if (availabilityRes.rowCount === 0) {
      return res.json({ ok: true, slots: [] });
    }
    const today = /* @__PURE__ */ new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today.getTime() + LOOKAHEAD_DAYS * 24 * 3600 * 1e3);
    const sessionsRes = await pool.query(
      `select start_time, end_time from class_sessions
       where organization_id = $1 and tutor_id = $2 and status = 'scheduled'
         and start_time >= $3 and start_time < $4`,
      [orgId, query.tutorId, today.toISOString(), horizon.toISOString()]
    );
    const busy = sessionsRes.rows.map((r) => ({ start: new Date(r.start_time).getTime(), end: new Date(r.end_time).getTime() }));
    const durationMs = query.durationMinutes * 60 * 1e3;
    const slots = [];
    const now = Date.now();
    for (let d = new Date(today); d <= horizon && slots.length < MAX_SLOTS; d.setDate(d.getDate() + 1)) {
      const dayAvailability = availabilityRes.rows.filter((a) => a.day_of_week === d.getDay());
      for (const window of dayAvailability) {
        if (slots.length >= MAX_SLOTS) break;
        const [startH, startM] = String(window.start_time).split(":").map(Number);
        const [endH, endM] = String(window.end_time).split(":").map(Number);
        const windowStart = new Date(d);
        windowStart.setHours(startH, startM, 0, 0);
        const windowEnd = new Date(d);
        windowEnd.setHours(endH, endM, 0, 0);
        for (let cursor = windowStart.getTime(); cursor + durationMs <= windowEnd.getTime(); cursor += 15 * 60 * 1e3) {
          if (cursor < now) continue;
          const slotEnd = cursor + durationMs;
          const overlaps = busy.some((b) => cursor < b.end && slotEnd > b.start);
          if (!overlaps) {
            slots.push({ start: new Date(cursor).toISOString(), end: new Date(slotEnd).toISOString() });
            if (slots.length >= MAX_SLOTS) break;
          }
        }
      }
    }
    res.json({ ok: true, slots });
  } catch (err) {
    next(err);
  }
});
var scheduling_default = router8;

// server/routes/cron.ts
import express9 from "express";
var router9 = express9.Router();
router9.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.header("x-cron-secret") !== secret) {
    return res.status(404).json({ error: { code: "not_found", message: "Not found" } });
  }
  next();
});
router9.post("/materialize-sessions", async (_req, res, next) => {
  try {
    const templatesRes = await pool.query(`${TEMPLATE_SELECT} where ${MATERIALIZABLE}`);
    const aggregate = { created: [], conflicts: [], templatesProcessed: 0 };
    for (const row of templatesRes.rows) {
      const r = await materializeTemplate(row);
      aggregate.created.push(...r.created);
      aggregate.conflicts.push(...r.conflicts);
      aggregate.templatesProcessed++;
    }
    res.json({ ok: true, ...aggregate });
  } catch (err) {
    next(err);
  }
});
var cron_default = router9;

// server/routes/documents.ts
import express10 from "express";
import multer from "multer";
import { randomUUID } from "crypto";

// shared/schemas/documents.ts
import { z as z7 } from "zod";
var documentMetaRequestSchema = z7.object({
  studentId: z7.string().uuid(),
  category: z7.string().min(1),
  notes: z7.string().optional().default("")
});

// server/routes/documents.ts
var router10 = express10.Router();
router10.use(authenticateToken, requireOrg);
var BUCKET = "documents";
var CAN_UPLOAD = ["owner", "admin", "tutor", "frontdesk"];
var upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
var MAGIC_BYTES = [
  { contentType: "application/pdf", signatures: [[37, 80, 68, 70]] },
  // %PDF
  { contentType: "image/png", signatures: [[137, 80, 78, 71]] },
  { contentType: "image/jpeg", signatures: [[255, 216, 255]] },
  // .doc (OLE compound file) and .docx (zip/PK) share these prefixes.
  { contentType: "application/msword", signatures: [[208, 207, 17, 224]] },
  { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signatures: [[80, 75, 3, 4]] }
];
function sniffContentType(buffer) {
  for (const { contentType, signatures } of MAGIC_BYTES) {
    if (signatures.some((sig) => sig.every((byte, i) => buffer[i] === byte))) return contentType;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  if (sample.length > 0 && !sample.includes(0) && /^[\x09\x0A\x0D\x20-\x7E -￿]*$/.test(sample.toString("utf-8"))) {
    return "text/plain";
  }
  return null;
}
function sanitizeFilename(name) {
  const base = name.replace(/^.*[\\/]/, "");
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
  return cleaned || "file";
}
router10.post("/", requireRole(...CAN_UPLOAD), upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: { code: "no_file", message: "No file uploaded" } });
    const body = documentMetaRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const sniffed = sniffContentType(req.file.buffer);
    if (!sniffed) {
      return res.status(422).json({ error: { code: "unsupported_type", message: "File content doesn't match a supported document type (PDF, PNG, JPEG, DOC, DOCX, or plain text)" } });
    }
    const safeName = sanitizeFilename(req.file.originalname);
    const storagePath = `orgs/${orgId}/documents/${body.studentId}/${Date.now()}-${randomUUID()}-${safeName}`;
    const { error: uploadErr } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, req.file.buffer, {
      contentType: sniffed,
      metadata: { uploadedBy: req.user.id, organizationId: orgId }
    });
    if (uploadErr) throw uploadErr;
    const { data: doc, error: insertErr } = await supabaseAdmin.from("documents").insert({
      organization_id: orgId,
      tutor_id: req.user.role === "tutor" ? req.user.id : null,
      student_id: body.studentId,
      file_name: safeName,
      storage_path: storagePath,
      content_type: sniffed,
      category: body.category,
      notes: body.notes,
      uploaded_by_user_id: req.user.id
    }).select("id").single();
    if (insertErr) throw insertErr;
    await writeAudit(orgId, req.user.id, "document.upload", "documents", doc.id, { fileName: safeName, category: body.category });
    res.json({ ok: true, documentId: doc.id });
  } catch (err) {
    next(err);
  }
});
router10.get("/:documentId/url", async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const { data: doc, error } = await supabaseAdmin.from("documents").select("organization_id, storage_path, uploaded_by_user_id").eq("id", req.params.documentId).maybeSingle();
    if (error) throw error;
    if (!doc) return res.status(404).json({ error: { code: "not_found", message: "Document not found" } });
    if (doc.organization_id !== orgId) return res.status(403).json({ error: { code: "forbidden", message: "Document belongs to another organization" } });
    if (!doc.storage_path) return res.status(422).json({ error: { code: "legacy_document", message: "This document predates Cloud Storage and has no signed-URL path" } });
    const isStaff = ["owner", "admin", "tutor", "frontdesk"].includes(req.user.role || "");
    if (!isStaff && doc.uploaded_by_user_id !== req.user.id) {
      return res.status(403).json({ error: { code: "forbidden", message: "Not authorized to view this document" } });
    }
    const { data: signed, error: signErr } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(doc.storage_path, 15 * 60);
    if (signErr) throw signErr;
    res.json({ ok: true, url: signed.signedUrl });
  } catch (err) {
    next(err);
  }
});
router10.delete("/:documentId", requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const { data: doc, error } = await supabaseAdmin.from("documents").select("organization_id, storage_path").eq("id", req.params.documentId).maybeSingle();
    if (error) throw error;
    if (!doc) return res.status(404).json({ error: { code: "not_found", message: "Document not found" } });
    if (doc.organization_id !== orgId) return res.status(403).json({ error: { code: "forbidden", message: "Document belongs to another organization" } });
    if (doc.storage_path) {
      await supabaseAdmin.storage.from(BUCKET).remove([doc.storage_path]);
    }
    const { error: delErr } = await supabaseAdmin.from("documents").delete().eq("id", req.params.documentId);
    if (delErr) throw delErr;
    await writeAudit(orgId, req.user.id, "document.delete", "documents", req.params.documentId, {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
var documents_default = router10;

// server/routes/inbox.ts
import express11 from "express";
import { z as z9 } from "zod";

// shared/schemas/inbox.ts
import { z as z8 } from "zod";
var ensureClassChannelResponseSchema = z8.object({
  ok: z8.literal(true),
  conversationId: z8.string().uuid(),
  participantCount: z8.number().int().nonnegative()
});

// server/routes/inbox.ts
var router11 = express11.Router();
router11.use(authenticateToken, requireOrg);
var templateIdParamSchema = z9.object({ templateId: z9.string().uuid() });
async function resolveClassParticipantIds(client, orgId, templateId) {
  const templateRes = await client.query(
    `select tutor_id from class_templates where id = $1 and organization_id = $2`,
    [templateId, orgId]
  );
  if (templateRes.rowCount === 0) {
    throw Object.assign(new Error("Class not found"), { status: 404, code: "not_found" });
  }
  const tutorId = templateRes.rows[0].tutor_id;
  const rosterRes = await client.query(
    `select student_id from enrollments where template_id = $1 and status = 'active'`,
    [templateId]
  );
  const studentIds = rosterRes.rows.map((r) => r.student_id);
  if (studentIds.length === 0) return { tutorId, studentUserIds: [], parentUserIds: [] };
  const { rows } = await client.query(
    `select 'student' as kind, student_user_id as user_id
       from students where id = any($1::uuid[]) and student_user_id is not null
     union
     select 'parent', parent_user_id
       from parent_links where student_id = any($1::uuid[])`,
    [studentIds]
  );
  return {
    tutorId,
    studentUserIds: rows.filter((r) => r.kind === "student").map((r) => r.user_id),
    parentUserIds: rows.filter((r) => r.kind === "parent").map((r) => r.user_id)
  };
}
router11.post("/class-channels/:templateId/ensure", async (req, res, next) => {
  try {
    const { templateId } = templateIdParamSchema.parse(req.params);
    const orgId = req.user.organizationId;
    const result = await withTransaction(async (client) => {
      const { tutorId, studentUserIds, parentUserIds } = await resolveClassParticipantIds(client, orgId, templateId);
      const participantIds = Array.from(/* @__PURE__ */ new Set([...tutorId ? [tutorId] : [], ...studentUserIds, ...parentUserIds]));
      const upsertRes = await client.query(
        `insert into conversations (organization_id, participant_ids, kind, anchor_type, anchor_id)
         values ($1, $2, 'class_channel', 'class', $3)
         on conflict (organization_id, anchor_id) where kind = 'class_channel'
         do update set participant_ids = excluded.participant_ids
         returning id`,
        [orgId, participantIds, templateId]
      );
      return { conversationId: upsertRes.rows[0].id, participantCount: participantIds.length };
    });
    res.json(ensureClassChannelResponseSchema.parse({ ok: true, ...result }));
  } catch (err) {
    next(err);
  }
});
var inbox_default = router11;

// server/routes/subscription.ts
import express12 from "express";

// shared/schemas/subscription.ts
import { z as z10 } from "zod";
var subscriptionResponseSchema = z10.object({
  plan: z10.enum(PLAN_IDS),
  status: z10.string(),
  studentLimit: z10.number().int().nullable(),
  activeStudentCount: z10.number().int(),
  pricePaise: z10.number().int(),
  trialEndsAt: z10.string().nullable(),
  currentPeriodEnd: z10.string().nullable(),
  razorpayConnected: z10.boolean()
});
var checkoutRequestSchema = z10.object({
  plan: z10.enum(PLAN_IDS)
});
var checkoutResponseSchema = z10.union([
  z10.object({ degraded: z10.literal(true), message: z10.string() }),
  z10.object({ degraded: z10.literal(false), shortUrl: z10.string() })
]);

// server/routes/subscription.ts
var router12 = express12.Router();
router12.use(authenticateToken, requireOrg);
router12.get("/", requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const { data: sub, error } = await supabaseAdmin.from("subscriptions").select("plan, status, student_limit, price_paise, trial_ends_at, current_period_end").eq("organization_id", orgId).maybeSingle();
    if (error) throw error;
    const { count, error: countErr } = await supabaseAdmin.from("students").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_deleted", false).eq("status", "active");
    if (countErr) throw countErr;
    const plan = sub?.plan && isPlanId(sub.plan) ? sub.plan : "free";
    const body = {
      plan,
      status: sub?.status || "active",
      studentLimit: sub?.student_limit ?? PLAN_CATALOG[plan].studentLimit,
      activeStudentCount: count || 0,
      pricePaise: sub?.price_paise ?? PLAN_CATALOG[plan].pricePaise,
      trialEndsAt: sub?.trial_ends_at ?? null,
      currentPeriodEnd: sub?.current_period_end ?? null,
      razorpayConnected: Boolean(process.env.PLATFORM_RAZORPAY_KEY_ID)
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
router12.post("/checkout", requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const { plan } = checkoutRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const target = PLAN_CATALOG[plan];
    if (!process.env.PLATFORM_RAZORPAY_KEY_ID || !process.env.PLATFORM_RAZORPAY_PLAN_IDS) {
      await writeAudit(orgId, req.user.id, "subscription.checkout_requested_degraded", "subscriptions", orgId, { plan });
      return res.json({
        degraded: true,
        message: `Upgrading to ${target.name} isn't self-serve yet. Email us and we'll switch your plan by hand.`
      });
    }
    const planIds = JSON.parse(process.env.PLATFORM_RAZORPAY_PLAN_IDS);
    const razorpayPlanId = planIds[plan];
    if (!razorpayPlanId) {
      return res.status(500).json({ error: { code: "plan_not_configured", message: `No Razorpay plan id configured for ${plan}` } });
    }
    const authHeader2 = "Basic " + Buffer.from(`${process.env.PLATFORM_RAZORPAY_KEY_ID}:${process.env.PLATFORM_RAZORPAY_KEY_SECRET}`).toString("base64");
    const rzpRes = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader2 },
      body: JSON.stringify({
        plan_id: razorpayPlanId,
        total_count: 120,
        // 10 years of monthly cycles; cancel/change anytime
        notes: { organizationId: orgId, targetPlan: plan }
      })
    });
    const json = await rzpRes.json().catch(() => ({}));
    if (!rzpRes.ok) {
      const message = json?.error?.description || `Razorpay error ${rzpRes.status}`;
      throw Object.assign(new Error(message), { status: 502, code: "gateway_error" });
    }
    await supabaseAdmin.from("subscriptions").update({ razorpay_subscription_id: json.id, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("organization_id", orgId);
    await writeAudit(orgId, req.user.id, "subscription.checkout_created", "subscriptions", orgId, { plan, razorpaySubscriptionId: json.id });
    res.json({ degraded: false, shortUrl: json.short_url });
  } catch (err) {
    next(err);
  }
});
var subscription_default = router12;

// server/routes/admin.ts
import express13 from "express";

// server/utils/platformAudit.ts
async function writePlatformAudit(actorId, action, opts = {}) {
  const { error } = await supabaseAdmin.from("platform_admin_actions").insert({
    actor_id: actorId,
    action,
    target_organization_id: opts.targetOrganizationId ?? null,
    target_user_id: opts.targetUserId ?? null,
    payload: opts.payload ?? {}
  });
  if (error) console.error("Failed to write platform admin audit event", error);
}

// shared/schemas/admin.ts
import { z as z11 } from "zod";
var orgHealthSchema = z11.object({
  id: z11.string().uuid(),
  name: z11.string(),
  createdAt: z11.string(),
  plan: z11.string(),
  subscriptionStatus: z11.string(),
  studentLimit: z11.number().int().nullable(),
  activeStudentCount: z11.number().int(),
  memberCount: z11.number().int(),
  lastActivityAt: z11.string().nullable()
});
var listOrgsResponseSchema = z11.object({ orgs: z11.array(orgHealthSchema) });
var setFeatureFlagRequestSchema = z11.object({
  key: z11.string().min(1).max(60),
  enabled: z11.boolean()
});
var impersonateRequestSchema = z11.object({
  userId: z11.string().uuid()
});
var impersonateResponseSchema = z11.object({ actionLink: z11.string() });

// server/routes/admin.ts
var router13 = express13.Router();
router13.use(authenticateToken, requirePlatformAdmin);
router13.get("/orgs", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      select
        o.id,
        o.name,
        o.created_at,
        coalesce(s.plan, 'free') as plan,
        coalesce(s.status, 'active') as subscription_status,
        s.student_limit,
        coalesce(st.n, 0) as active_student_count,
        coalesce(om.n, 0) as member_count,
        ae.last_activity_at
      from organizations o
      left join subscriptions s on s.organization_id = o.id
      left join (
        select organization_id, count(*)::int as n from students
        where is_deleted = false and status = 'active' group by organization_id
      ) st on st.organization_id = o.id
      left join (
        select organization_id, count(*)::int as n from organization_members group by organization_id
      ) om on om.organization_id = o.id
      left join (
        select organization_id, max(created_at) as last_activity_at from audit_events group by organization_id
      ) ae on ae.organization_id = o.id
      order by o.created_at desc
    `);
    const body = {
      orgs: rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: new Date(r.created_at).toISOString(),
        plan: r.plan,
        subscriptionStatus: r.subscription_status,
        studentLimit: r.student_limit,
        activeStudentCount: r.active_student_count,
        memberCount: r.member_count,
        lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at).toISOString() : null
      }))
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
router13.get("/orgs/:orgId/members", async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const { data: members, error } = await supabaseAdmin.from("organization_members").select("user_id, role").eq("organization_id", orgId);
    if (error) throw error;
    const userIds = (members || []).map((m) => m.user_id);
    const { data: profiles, error: profileErr } = userIds.length ? await supabaseAdmin.from("profiles").select("id, name, email").in("id", userIds) : { data: [], error: null };
    if (profileErr) throw profileErr;
    const profileById = new Map((profiles || []).map((p) => [p.id, p]));
    res.json({
      members: (members || []).map((m) => ({
        user_id: m.user_id,
        role: m.role,
        profiles: profileById.get(m.user_id) ?? null
      }))
    });
  } catch (err) {
    next(err);
  }
});
router13.put("/orgs/:orgId/feature-flags", async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const { key, enabled } = setFeatureFlagRequestSchema.parse(req.body);
    const { error } = await supabaseAdmin.from("feature_flags").upsert({ organization_id: orgId, key, enabled }, { onConflict: "organization_id,key" });
    if (error) throw error;
    await writePlatformAudit(req.user.id, "feature_flag.set", { targetOrganizationId: orgId, payload: { key, enabled } });
    await writeAudit(orgId, req.user.id, "platform_admin.feature_flag_set", "feature_flags", `${orgId}_${key}`, { key, enabled });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
router13.post("/impersonate", async (req, res, next) => {
  try {
    const { userId } = impersonateRequestSchema.parse(req.body);
    const { data: profile, error: profileErr } = await supabaseAdmin.from("profiles").select("email, organization_id").eq("id", userId).maybeSingle();
    if (profileErr) throw profileErr;
    if (!profile?.email) {
      return res.status(404).json({ error: { code: "not_found", message: "User has no profile/email on record" } });
    }
    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email
    });
    if (linkErr) throw linkErr;
    await writePlatformAudit(req.user.id, "impersonate", {
      targetUserId: userId,
      targetOrganizationId: profile.organization_id ?? void 0,
      payload: { email: profile.email }
    });
    if (profile.organization_id) {
      await writeAudit(profile.organization_id, req.user.id, "platform_admin.impersonate", "profiles", userId, {
        note: "A ClassStackr platform admin generated a login link for this account for support purposes."
      });
    }
    const body = { actionLink: linkData.properties.action_link };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
var admin_default = router13;

// server/routes/orgExport.ts
import express14 from "express";
import ExcelJS from "exceljs";

// server/utils/orgExport.ts
var EXPORT_TABLES = [
  { key: "organization", query: "select id, name, address, phone, email, created_at from organizations where id = $1" },
  {
    key: "members",
    query: `select om.user_id, om.role, om.created_at, p.name, p.email
            from organization_members om left join profiles p on p.id = om.user_id
            where om.organization_id = $1`
  },
  { key: "students", query: "select * from students where organization_id = $1 order by created_at" },
  { key: "courses", query: "select * from courses where organization_id = $1 order by created_at" },
  { key: "class_sessions", query: "select * from class_sessions where organization_id = $1 order by start_time" },
  { key: "enrollments", query: "select * from enrollments where organization_id = $1 order by created_at" },
  { key: "attendance_records", query: "select * from attendance_records where organization_id = $1 order by session_start" },
  { key: "invoices", query: "select * from invoices where organization_id = $1 order by created_at" },
  { key: "payments", query: "select * from payments where organization_id = $1 order by at" },
  { key: "refunds", query: "select * from refunds where organization_id = $1 order by at" },
  { key: "wallets", query: "select * from wallets where organization_id = $1" },
  { key: "wallet_ledger", query: "select * from wallet_ledger where organization_id = $1 order by at" },
  { key: "parent_links", query: "select * from parent_links where organization_id = $1" },
  { key: "leads", query: "select * from leads where organization_id = $1 order by created_at" },
  { key: "subscriptions", query: "select plan, status, student_limit, price_paise, trial_ends_at, current_period_end, updated_at from subscriptions where organization_id = $1" }
];
async function fetchOrgExportData(orgId) {
  return Promise.all(
    EXPORT_TABLES.map(async (table) => {
      const { rows } = await pool.query(table.query, [orgId]);
      return { key: table.key, rows };
    })
  );
}

// shared/schemas/orgExport.ts
import { z as z12 } from "zod";
var offboardRequestSchema = z12.object({
  // The caller must type the org's exact current name to confirm — same
  // "type to confirm" pattern as other irreversible-ish SaaS actions.
  confirmOrgName: z12.string().min(1)
});
var offboardResponseSchema = z12.object({ ok: z12.literal(true) });

// server/routes/orgExport.ts
var router14 = express14.Router();
router14.use(authenticateToken, requireOrg);
router14.get("/json", requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const tables = await fetchOrgExportData(orgId);
    const payload = { exportedAt: (/* @__PURE__ */ new Date()).toISOString() };
    for (const t of tables) payload[t.key] = t.rows;
    await writeAudit(orgId, req.user.id, "org.export_json", "organizations", orgId, {});
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="org-export-${orgId}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    next(err);
  }
});
router14.get("/xlsx", requireRole("owner", "admin"), async (req, res, next) => {
  try {
    const orgId = req.user.organizationId;
    const tables = await fetchOrgExportData(orgId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ClassStackr";
    workbook.created = /* @__PURE__ */ new Date();
    for (const t of tables) {
      const sheet = workbook.addWorksheet(t.key.slice(0, 31));
      const columns = t.rows.length > 0 ? Object.keys(t.rows[0]) : [];
      sheet.columns = columns.map((c) => ({ header: c, key: c, width: 20 }));
      for (const row of t.rows) {
        const flat = {};
        for (const c of columns) {
          const v = row[c];
          flat[c] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
        }
        sheet.addRow(flat);
      }
    }
    const buffer = await workbook.xlsx.writeBuffer();
    await writeAudit(orgId, req.user.id, "org.export_xlsx", "organizations", orgId, {});
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="org-export-${orgId}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
});
router14.post("/offboard", requireRole("owner"), async (req, res, next) => {
  try {
    const { confirmOrgName } = offboardRequestSchema.parse(req.body);
    const orgId = req.user.organizationId;
    const { data: org, error: orgErr } = await supabaseAdmin.from("organizations").select("name, status").eq("id", orgId).single();
    if (orgErr) throw orgErr;
    if (org.status === "offboarded") {
      return res.status(409).json({ error: { code: "already_offboarded", message: "This organization is already offboarded" } });
    }
    if (confirmOrgName.trim() !== org.name.trim()) {
      return res.status(422).json({ error: { code: "name_mismatch", message: "Typed name doesn't match the organization's name" } });
    }
    const { error } = await supabaseAdmin.from("organizations").update({ status: "offboarded", offboarded_at: (/* @__PURE__ */ new Date()).toISOString(), offboarded_by: req.user.id }).eq("id", orgId);
    if (error) throw error;
    invalidateAllMemberships();
    await writeAudit(orgId, req.user.id, "org.offboarded", "organizations", orgId, {});
    const body = { ok: true };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
var orgExport_default = router14;

// server/routes/auditLog.ts
import express15 from "express";

// shared/schemas/auditLog.ts
import { z as z13 } from "zod";
var auditLogQuerySchema = z13.object({
  orgId: z13.string().uuid().optional(),
  actorId: z13.string().uuid().optional(),
  entityType: z13.string().min(1).max(60).optional(),
  from: z13.string().datetime().optional(),
  to: z13.string().datetime().optional(),
  limit: z13.coerce.number().int().min(1).max(200).default(50),
  offset: z13.coerce.number().int().min(0).default(0)
});
var auditEventSchema = z13.object({
  id: z13.string().uuid(),
  organizationId: z13.string().uuid(),
  organizationName: z13.string().nullable(),
  actorId: z13.string().uuid().nullable(),
  actorName: z13.string().nullable(),
  actorEmail: z13.string().nullable(),
  // Set when the action had no signed-in user behind it (e.g. a payment
  // gateway webhook). actorId is null in that case, which on its own is
  // indistinguishable from a user who was later deleted — actor_id is
  // `on delete set null`. See AuditActor in server/utils/audit.ts.
  systemActor: z13.string().nullable(),
  action: z13.string(),
  entityType: z13.string().nullable(),
  entityId: z13.string().nullable(),
  payload: z13.record(z13.string(), z13.unknown()),
  createdAt: z13.string()
});
var listAuditEventsResponseSchema = z13.object({
  events: z13.array(auditEventSchema),
  total: z13.number().int()
});

// server/routes/auditLog.ts
var router15 = express15.Router();
router15.use(authenticateToken);
var ORG_SCOPED_ROLES = /* @__PURE__ */ new Set(["owner", "admin", "accountant"]);
router15.get("/", async (req, res, next) => {
  try {
    const query = auditLogQuerySchema.parse(req.query);
    const userId = req.user.id;
    const { rowCount: isPlatformAdmin } = await pool.query(
      `select 1 from platform_admins where user_id = $1 limit 1`,
      [userId]
    );
    let orgId;
    if (isPlatformAdmin) {
      orgId = query.orgId ?? null;
    } else {
      if (!req.user.organizationId || !ORG_SCOPED_ROLES.has(req.user.role ?? "")) {
        return res.status(403).json({ error: { code: "forbidden", message: "Not authorized to view the audit log" } });
      }
      orgId = req.user.organizationId;
    }
    const params = [
      orgId,
      query.actorId ?? null,
      query.entityType ?? null,
      query.from ?? null,
      query.to ?? null
    ];
    const whereClause = `
      where ($1::uuid is null or ae.organization_id = $1)
        and ($2::uuid is null or ae.actor_id = $2)
        and ($3::text is null or ae.payload ->> 'entityType' = $3)
        and ($4::timestamptz is null or ae.created_at >= $4)
        and ($5::timestamptz is null or ae.created_at <= $5)
    `;
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `
        select
          ae.id,
          ae.organization_id,
          o.name as organization_name,
          ae.actor_id,
          p.name as actor_name,
          p.email as actor_email,
          ae.action,
          ae.payload ->> 'entityType' as entity_type,
          ae.payload ->> 'entityId' as entity_id,
          ae.payload ->> 'systemActor' as system_actor,
          ae.payload,
          ae.created_at
        from audit_events ae
        join organizations o on o.id = ae.organization_id
        left join profiles p on p.id = ae.actor_id
        ${whereClause}
        order by ae.created_at desc
        limit $6 offset $7
        `,
        [...params, query.limit, query.offset]
      ),
      pool.query(`select count(*)::int as total from audit_events ae ${whereClause}`, params)
    ]);
    const body = {
      events: rows.map((r) => ({
        id: r.id,
        organizationId: r.organization_id,
        organizationName: r.organization_name,
        actorId: r.actor_id,
        actorName: r.actor_name,
        actorEmail: r.actor_email,
        systemActor: r.system_actor,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        payload: r.payload,
        createdAt: new Date(r.created_at).toISOString()
      })),
      total: countRows[0]?.total ?? 0
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});
var auditLog_default = router15;

// server/app.ts
function createApp() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: 0.1
    });
  }
  const app2 = express16();
  const isProd = process.env.NODE_ENV === "production";
  app2.use(pino({
    level: isProd ? "info" : "debug",
    redact: ["req.headers.authorization", "req.headers.cookie"],
    transport: isProd ? void 0 : {
      target: "pino-pretty",
      options: { colorize: true }
    }
  }));
  app2.use(helmet({
    contentSecurityPolicy: isProd ? void 0 : false,
    // Vite dev server needs inline scripts
    crossOriginEmbedderPolicy: isProd ? void 0 : false
  }));
  app2.use(cors({
    origin: isProd ? process.env.APP_URL : "http://localhost:3000",
    credentials: false
    // header-based auth only; no cookies, no CSRF surface
  }));
  app2.set("trust proxy", 1);
  app2.use("/api/webhooks", express16.raw({ type: "*/*", limit: "1mb" }), webhooks_default);
  const apiLimiter = rateLimit({
    windowMs: 60 * 1e3,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    // Authenticated traffic is limited per user, not per shared NAT
    // (coaching centers share IPs). ipKeyGenerator handles IPv6 subnets.
    keyGenerator: (req) => req.user?.id || ipKeyGenerator(req.ip || "")
  });
  app2.use(express16.json({ limit: "1mb" }));
  app2.use("/api/", apiLimiter);
  app2.use("/api/v1/settings", settings_default);
  app2.use("/api/v1/members", members_default);
  app2.use("/api/v1/billing", billing_default);
  app2.use("/api/v1/gateway", gateway_default);
  app2.use("/api/v1/parents", parents_default);
  app2.use("/api/v1/students", students_default);
  app2.use("/api/v1/scheduling", scheduling_default);
  app2.use("/api/v1/documents", documents_default);
  app2.use("/api/v1/inbox", inbox_default);
  app2.use("/api/v1/subscription", subscription_default);
  app2.use("/api/v1/admin", admin_default);
  app2.use("/api/v1/org-export", orgExport_default);
  app2.use("/api/v1/audit-log", auditLog_default);
  app2.use("/api/cron", cron_default);
  app2.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app2.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Unknown API route" } });
  });
  app2.use((err, req, res, _next) => {
    if (err?.name === "ZodError") {
      return res.status(422).json({ error: { code: "validation", message: "Invalid request", details: err.issues } });
    }
    const status = typeof err?.status === "number" ? err.status : 500;
    const code = err?.code && typeof err.code === "string" ? err.code : "internal";
    req.log?.error({ err }, "Unhandled API error");
    if (status >= 500) Sentry.captureException(err);
    res.status(status).json({ error: { code, message: status === 500 ? "Internal Server Error" : err.message } });
  });
  return app2;
}

// server/vercelHandler.ts
var app = createApp();
var vercelHandler_default = app;
export {
  vercelHandler_default as default
};
