import express from "express";
import jwt from "jsonwebtoken";
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from "jose";
import { pool } from "../db.ts";

type Request = express.Request;
type Response = express.Response;
type NextFunction = express.NextFunction;

export type Role =
  | "owner"
  | "admin"
  | "tutor"
  | "frontdesk"
  | "accountant"
  | "parent"
  | "student";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: Role;
    organizationId?: string;
    organizationStatus?: string;
  };
}

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;

// Supabase now signs user access tokens with asymmetric JWT signing keys
// (ES256/RS256) by default; the legacy HS256 shared secret is only used to
// verify older tokens still in circulation. We verify accordingly:
//   - asymmetric tokens  -> Supabase's public JWKS endpoint (cached by jose)
//   - HS256 tokens       -> the legacy shared secret (SUPABASE_JWT_SECRET), if set
// This keeps working across the project's key rotation with no redeploy.
const jwks = SUPABASE_URL
  ? createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`))
  : null;

async function verifyAccessToken(token: string): Promise<{ sub: string; email?: string }> {
  const alg = decodeProtectedHeader(token).alg;

  if (alg === "HS256") {
    if (!SUPABASE_JWT_SECRET) {
      throw new Error("HS256 token received but SUPABASE_JWT_SECRET is not configured");
    }
    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (!decoded.sub) throw new Error("Missing sub claim");
    return { sub: decoded.sub, email: decoded.email as string | undefined };
  }

  if (!jwks) {
    throw new Error("SUPABASE_URL is required to verify asymmetric access tokens");
  }
  const { payload } = await jwtVerify(token, jwks);
  if (!payload.sub) throw new Error("Missing sub claim");
  return { sub: payload.sub, email: payload.email as string | undefined };
}

interface Membership {
  organizationId?: string;
  role?: Role;
  organizationStatus?: string;
}

// Optional in-process membership cache. OFF by default (ttl 0), because
// caching this weakens the guarantee documented on loadMembership below: a
// removed member would keep access for up to the TTL. Operators who would
// rather trade that window for one fewer DB hit per request can set
// AUTH_CACHE_TTL_MS (30_000 is a sane value). Invalidation on membership
// writes is wired up (see invalidateMembership) but is per-process — on
// serverless, sibling instances still wait out their own TTL, so keep it short.
const MEMBERSHIP_TTL_MS = Number(process.env.AUTH_CACHE_TTL_MS) || 0;
const membershipCache = new Map<string, { value: Membership; expiresAt: number }>();

/** Drop a user's cached membership. Call after any write that changes their
 *  role, org, or their org's status. No-op when the cache is disabled. */
export function invalidateMembership(userId: string) {
  membershipCache.delete(userId);
}

/** Drop every cached membership. Used for org-wide changes (offboarding
 *  flips organizations.status, which every member of that org has cached)
 *  where enumerating the affected users isn't worth a query. */
export function invalidateAllMemberships() {
  membershipCache.clear();
}

// Role/organizationId are read fresh from organization_members on every
// request instead of being embedded in the JWT (as Firebase custom claims
// were). That means removing a member or changing their role takes effect
// immediately on the next API call — no token-revocation step required,
// unlike the old adminAuth.revokeRefreshTokens() dance.
//
// This runs on literally every authenticated request, so it goes over the
// `pg` pool rather than PostgREST: supabaseAdmin would make an outbound HTTPS
// call to the Supabase REST API on each hop, which dwarfs the query itself.
// The join replaces PostgREST's `organizations(status)` embed and is covered
// by idx_org_members_user.
async function loadMembership(userId: string): Promise<Membership> {
  if (MEMBERSHIP_TTL_MS > 0) {
    const hit = membershipCache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

  // organization_members' primary key is (organization_id, user_id), so a
  // user genuinely can hold more than one row (e.g. a tutor working at two
  // centers) — without this order by, an unordered `limit 1` could pick a
  // different row per request. There is no org-switcher UI yet, so this
  // deterministically picks the earliest (first-joined) org as "home" until
  // one exists. See DEV_PLAN Tech Debt #5.
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
  const value: Membership = {
    organizationId: row?.organization_id ?? undefined,
    role: (row?.role as Role | undefined) ?? undefined,
    organizationStatus: row?.organization_status ?? undefined,
  };

  if (MEMBERSHIP_TTL_MS > 0) {
    membershipCache.set(userId, { value, expiresAt: Date.now() + MEMBERSHIP_TTL_MS });
  }
  return value;
}

// Soft, non-enforcing auth used only to key the rate limiter (server/app.ts)
// per-user instead of per-IP. It mounts before any route's authenticateToken,
// so it does its own lightweight JWT verify (no membership lookup, no 401 on
// failure) and silently leaves req.user unset for a missing/invalid token —
// that request still gets rate-limited by IP, and the real auth enforcement
// (and full req.user population) still happens downstream in each route's
// authenticateToken.
export const identifyUser = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (token && token !== "undefined" && token !== "null") {
    try {
      const { sub } = await verifyAccessToken(token);
      req.user = { id: sub };
    } catch {
      // Invalid/expired token: fall through to IP-based limiting. The route's
      // own authenticateToken will reject the request with 401 shortly after.
    }
  }
  next();
};

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

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
      organizationStatus: membership.organizationStatus,
    };
    next();
  } catch (err) {
    // Logged deliberately: this catch previously swallowed the real cause of
    // every 401 (JWKS fetch failure, clock skew, wrong SUPABASE_URL, a
    // Postgres error on the membership lookup, etc.), making a genuine auth
    // bug indistinguishable from an expired token in the logs.
    console.error("authenticateToken failed:", err);
    return res.status(401).json({ error: { code: "unauthenticated", message: "Invalid or expired token" } });
  }
};

export const requireRole = (...roles: Role[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: { code: "forbidden", message: "Insufficient role" } });
    }
    next();
  };
};

export const requireOrg = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user?.organizationId) {
    return res.status(403).json({ error: { code: "no_organization", message: "User does not belong to an organization" } });
  }
  // Blocks all org-scoped app usage once an org has been offboarded (see
  // 20260719130000_org_offboarding.sql) — organizationStatus is fetched
  // alongside the membership lookup in authenticateToken (one query, not
  // two) so this check adds no extra DB round trip. This is the actual
  // enforcement point, not a DB-level RLS rule, since offboarding is a
  // status flip and every existing RLS policy already scoped by
  // organization_id continues to permit reads/writes on its own.
  if (req.user.organizationStatus === "offboarded") {
    return res.status(403).json({ error: { code: "org_offboarded", message: "This organization has been offboarded" } });
  }
  next();
};

// Platform-level allowlist (platform_admins table), completely decoupled
// from any org's own RBAC — see 20260719120000_super_admin.sql's header for
// why. Deliberately does NOT require requireOrg: a platform admin acts
// across every org, not from within one.
export const requirePlatformAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
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
