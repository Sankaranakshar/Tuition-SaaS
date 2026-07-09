import express from "express";
import jwt from "jsonwebtoken";
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from "jose";
import { supabaseAdmin } from "../supabaseAdmin.ts";

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

// Role/organizationId are read fresh from organization_members on every
// request instead of being embedded in the JWT (as Firebase custom claims
// were). That means removing a member or changing their role takes effect
// immediately on the next API call — no token-revocation step required,
// unlike the old adminAuth.revokeRefreshTokens() dance.
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

    const { data: membership, error } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    req.user = {
      id: userId,
      email,
      role: membership?.role as Role | undefined,
      organizationId: membership?.organization_id as string | undefined,
    };
    next();
  } catch (err) {
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
  next();
};
