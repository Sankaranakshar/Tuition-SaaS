import express from "express";
type Request = express.Request;
type Response = express.Response;
type NextFunction = express.NextFunction;
import { adminAuth } from "../firebaseAdmin.ts";

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

// Roles come exclusively from Firebase custom claims, which only the server
// can set (see routes/members.ts). Client-writable documents are never
// consulted for authorization.
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
    if (!adminAuth) {
      console.error("Firebase Admin not initialized");
      return res.status(500).json({ error: { code: "internal", message: "Internal Server Error" } });
    }
    // checkRevoked so removed members lose API access as soon as their
    // refresh tokens are revoked on role change.
    const decoded = await adminAuth.verifyIdToken(token, true);

    req.user = {
      id: decoded.uid,
      email: decoded.email,
      role: decoded.role as Role | undefined,
      organizationId: decoded.organizationId as string | undefined,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: { code: "unauthenticated", message: "Invalid or revoked token" } });
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
