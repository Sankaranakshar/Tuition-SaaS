import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../db.ts";
import { authenticateToken, requireRole, type AuthRequest } from "../middleware/auth.ts";
import crypto from "crypto";
import { z } from "zod";

const router = express.Router();

const storage = multer.memoryStorage();

const fileFilter = (req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain'
  ];
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PDF, JPEG, PNG, DOC, DOCX, and TXT are allowed.'));
  }
};

const upload = multer({ 
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter
});

router.use(authenticateToken);
router.use(requireRole("tutor"));

const documentSchema = z.object({
  student_id: z.string().regex(/^\d+$/).transform(Number),
  category: z.string().min(1).max(50),
  notes: z.string().max(500).optional()
});

router.get("/", (req: AuthRequest, res) => {
  const { student_id } = req.query;
  let query = `
    SELECT d.*, s.name as student_name 
    FROM documents d 
    JOIN students s ON d.student_id = s.id 
    WHERE d.tutor_id = ?
  `;
  
  const params: any[] = [req.user?.id];

  if (student_id) {
    query += ` AND d.student_id = ?`;
    params.push(student_id);
  }

  query += ` ORDER BY d.created_at DESC`;

  const stmt = db.prepare(query);
  const documents = stmt.all(...params);
  res.json(documents);
});

router.post("/upload", upload.single("file"), async (req: AuthRequest, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const validatedData = documentSchema.parse(req.body);
    const { student_id, category, notes } = validatedData;
    const tutorId = req.user?.id;

    const student: any = db.prepare("SELECT tutor_id FROM students WHERE id = ?").get(student_id);
    if (!student || student.tutor_id !== tutorId) {
      return res.status(403).json({ error: "Unauthorized or student not found" });
    }

    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(req.file.originalname);
    const filename = `${req.file.fieldname}-${uniqueSuffix}${ext}`;
    const dir = path.resolve(process.cwd(), "uploads");
    const filePath = path.join(dir, filename);

    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write file to disk only after validation
    fs.writeFileSync(filePath, req.file.buffer);

    const stmt = db.prepare(`
      INSERT INTO documents (tutor_id, student_id, file_name, file_path, category, notes, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(tutorId, student_id, req.file.originalname, filename, category, notes, tutorId);
    res.json({ message: "File uploaded successfully", id: result.lastInsertRowid });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.issues });
    }
    console.error("Upload error:", error);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

router.delete("/:id", (req: AuthRequest, res) => {
  const tutorId = req.user?.id;
  const docId = req.params.id;

  // Get file path before deleting
  const document: any = db.prepare("SELECT file_path FROM documents WHERE id = ? AND tutor_id = ?").get(docId, tutorId);
  
  if (!document) {
    return res.status(404).json({ error: "Document not found" });
  }

  // Delete from DB
  const stmt = db.prepare("DELETE FROM documents WHERE id = ? AND tutor_id = ?");
  stmt.run(docId, tutorId);

  // Delete from disk
  try {
    const filePath = path.resolve(process.cwd(), "uploads", document.file_path);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("Failed to delete file from disk:", error);
  }

  res.json({ message: "Document deleted" });
});

export default router;
