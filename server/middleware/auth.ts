import express from "express";
type Request = express.Request;
type Response = express.Response;
type NextFunction = express.NextFunction;
import { adminAuth, adminDb } from "../firebaseAdmin.ts";
import { db } from "../db.ts";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: string;
  };
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers["authorization"];
  let token = req.cookies?.token || (authHeader && authHeader.split(" ")[1]);

  if (token === "undefined" || token === "null") {
    token = undefined;
  }

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (!adminAuth) {
      console.error("Firebase Admin not initialized.");
      return res.status(500).json({ error: "Internal Server Error" });
    }
    const decodedToken = await adminAuth.verifyIdToken(token);
    const uid = decodedToken.uid;
    
    // Check SQLite first
    let user: any = db.prepare("SELECT role, name, email FROM users WHERE id = ?").get(uid);
    
    // If not in SQLite, try to sync from Firestore
    if (!user && adminDb) {
      try {
        const userDoc = await adminDb.collection("users").doc(uid).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          if (userData) {
            const email = decodedToken.email || userData.email;
            if (!email) {
              console.warn(`User ${uid} sync skipped: no email found in token or Firestore`);
            } else {
              // Sync to SQLite
              try {
                db.prepare(`
                  INSERT INTO users (id, email, name, role)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT(id) DO UPDATE SET
                    email = excluded.email,
                    name = excluded.name,
                    role = excluded.role
                `).run(uid, email, userData.name || "User", userData.role || "student");
                
                user = { role: userData.role, name: userData.name, email: email };
                console.log(`Synced user ${uid} from Firestore to SQLite`);
              } catch (dbError) {
                console.error(`Failed to insert/update user ${uid} in SQLite:`, dbError);
              }
            }
          }
        } else {
          console.warn(`User ${uid} document not found in Firestore during sync`);
        }
      } catch (syncError) {
        console.error(`Error syncing user ${uid} from Firestore:`, syncError);
      }
    }

    // Fallback to custom claims if still no role from DB, then default to 'student'
    let role = user?.role || decodedToken.role || "student";

    req.user = {
      id: uid,
      email: decodedToken.email,
      role: role,
    };
    next();
  } catch (err) {
    console.error("Error verifying Firebase token:", err);
    return res.status(403).json({ error: "Forbidden" });
  }
};

export const requireRole = (role: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== role && req.user?.role !== 'admin') {
      return res.status(403).json({ error: "Forbidden: Insufficient role" });
    }
    next();
  };
};


