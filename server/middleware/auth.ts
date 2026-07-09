import express from "express";
import jwt from "jsonwebtoken";
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

  if (!SUPABASE_JWT_SECRET) {
    console.error("SUPABASE_JWT_SECRET not configured");
    return res.status(500).json({ error: { code: "internal", message: "Internal Server Error" } });
  }

  try {
    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    const userId = decoded.sub;
    if (!userId) throw new Error("Missing sub claim");

    const { data: membership, error } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    req.user = {
      id: userId,
      email: decoded.email as string | undefined,
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
