import express from "express";
import { db } from "../db.ts";
import { authenticateToken, requireRole, type AuthRequest } from "../middleware/auth.ts";
import crypto from "crypto";
import { z } from "zod";

const router = express.Router();

router.use(authenticateToken);
router.use(requireRole("tutor"));

const studentSchema = z.object({
  name: z.string().min(1).max(100),
  grade: z.string().min(1).max(50),
  subject: z.string().min(1).max(100),
  fee_structure: z.enum(['hourly', 'monthly', 'per_class']),
  fee_amount: z.number().positive(),
  parent_name: z.string().max(100).optional(),
  parent_email: z.string().email().optional().or(z.literal('')),
  parent_phone: z.string().max(20).optional()
});

router.get("/", (req: AuthRequest, res) => {
  const stmt = db.prepare(`
    SELECT s.*, p.name as parent_name, p.phone as parent_phone 
    FROM students s 
    LEFT JOIN users p ON s.parent_id = p.id 
    WHERE s.tutor_id = ?
  `);
  const students = stmt.all(req.user?.id);
  res.json(students);
});

router.post("/", (req: AuthRequest, res) => {
  try {
    const validatedData = studentSchema.parse(req.body);
    const { name, grade, subject, fee_structure, fee_amount, parent_name, parent_email, parent_phone } = validatedData;
    
    const insertTransaction = db.transaction(() => {
      let parentId = null;
      
      if (parent_email) {
        const existingParent: any = db.prepare("SELECT id FROM users WHERE email = ?").get(parent_email);
        if (existingParent) {
          parentId = existingParent.id;
        } else {
          parentId = crypto.randomUUID();
          db.prepare("INSERT INTO users (id, email, name, role, phone) VALUES (?, ?, ?, 'parent', ?)").run(parentId, parent_email, parent_name || "Parent", parent_phone);
        }
      }

      const insertStudent = db.prepare(`
        INSERT INTO students (tutor_id, name, grade, subject, fee_structure, fee_amount, parent_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      return insertStudent.run(req.user?.id, name, grade, subject, fee_structure, fee_amount, parentId);
    });

    const result = insertTransaction();
    
    res.json({ message: "Student added successfully", id: result.lastInsertRowid });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.issues });
    }
    res.status(500).json({ error: "Failed to add student" });
  }
});

router.get("/:id", (req: AuthRequest, res) => {
  const stmt = db.prepare(`
    SELECT s.*, p.name as parent_name, p.phone as parent_phone, p.email as parent_email
    FROM students s 
    LEFT JOIN users p ON s.parent_id = p.id 
    WHERE s.id = ? AND s.tutor_id = ?
  `);
  const student = stmt.get(req.params.id, req.user?.id);
  if (!student) return res.status(404).json({ error: "Student not found" });
  res.json(student);
});

router.put("/:id", (req: AuthRequest, res) => {
  try {
    const validatedData = studentSchema.partial().parse(req.body);
    const { name, grade, subject, fee_structure, fee_amount } = validatedData;
    
    // Build dynamic update query based on provided fields
    const updates: string[] = [];
    const values: any[] = [];
    
    if (name !== undefined) { updates.push("name = ?"); values.push(name); }
    if (grade !== undefined) { updates.push("grade = ?"); values.push(grade); }
    if (subject !== undefined) { updates.push("subject = ?"); values.push(subject); }
    if (fee_structure !== undefined) { updates.push("fee_structure = ?"); values.push(fee_structure); }
    if (fee_amount !== undefined) { updates.push("fee_amount = ?"); values.push(fee_amount); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }
    
    values.push(req.params.id, req.user?.id);
    
    const stmt = db.prepare(`
      UPDATE students 
      SET ${updates.join(", ")}
      WHERE id = ? AND tutor_id = ?
    `);
    
    const result = stmt.run(...values);
    if (result.changes === 0) return res.status(404).json({ error: "Student not found" });
    res.json({ message: "Student updated successfully" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.issues });
    }
    res.status(500).json({ error: "Failed to update student" });
  }
});

router.delete("/:id", (req: AuthRequest, res) => {
  const stmt = db.prepare("DELETE FROM students WHERE id = ? AND tutor_id = ?");
  const result = stmt.run(req.params.id, req.user?.id);
  if (result.changes === 0) return res.status(404).json({ error: "Student not found" });
  res.json({ message: "Student deleted successfully" });
});

export default router;
