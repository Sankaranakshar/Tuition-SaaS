import express from "express";
import { db } from "../db.ts";
import { authenticateToken, requireRole, type AuthRequest } from "../middleware/auth.ts";
import crypto from "crypto";
import { z } from "zod";

const router = express.Router();

router.use(authenticateToken);
router.use(requireRole("tutor"));

const invoiceSchema = z.object({
  student_id: z.number().int().positive(),
  amount: z.number().positive(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)")
});

router.get("/", (req: AuthRequest, res) => {
  const stmt = db.prepare(`
    SELECT i.*, s.name as student_name 
    FROM invoices i 
    JOIN students s ON i.student_id = s.id 
    WHERE i.tutor_id = ?
    ORDER BY i.issue_date DESC
  `);
  const invoices = stmt.all(req.user?.id);
  res.json(invoices);
});

router.post("/", (req: AuthRequest, res) => {
  try {
    const validatedData = invoiceSchema.parse(req.body);
    const { student_id, amount, issue_date, due_date } = validatedData;
    const tutorId = req.user?.id;

    const student: any = db.prepare("SELECT parent_id, tutor_id FROM students WHERE id = ?").get(student_id);
    
    if (!student || student.tutor_id !== tutorId) {
      return res.status(403).json({ error: "Unauthorized or student not found" });
    }

    const parentId = student.parent_id;

    const stmt = db.prepare(`
      INSERT INTO invoices (tutor_id, student_id, parent_id, amount, issue_date, due_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(tutorId, student_id, parentId, amount, issue_date, due_date);
    res.json({ message: "Invoice generated successfully", id: result.lastInsertRowid });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.issues });
    }
    res.status(500).json({ error: "Failed to generate invoice" });
  }
});

router.put("/:id/pay", (req: AuthRequest, res) => {
  const stmt = db.prepare("UPDATE invoices SET status = 'paid' WHERE id = ? AND tutor_id = ?");
  stmt.run(req.params.id, req.user?.id);
  res.json({ message: "Invoice marked as paid" });
});

export default router;
