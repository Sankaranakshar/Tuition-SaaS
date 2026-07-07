import express from "express";
import { authenticateToken, type AuthRequest } from "../middleware/auth.ts";

const router = express.Router();

// The frontend uses Firebase Auth directly. 
// This route is kept for testing the Firebase Admin SDK token verification.
router.get("/me", authenticateToken, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

export default router;

