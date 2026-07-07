import express from "express";
import { db } from "../db.ts";
import { authenticateToken, type AuthRequest } from "../middleware/auth.ts";
import { z } from "zod";

const router = express.Router();

router.use(authenticateToken);

const messageSchema = z.object({
  receiver_id: z.string().min(1),
  content: z.string().min(1).max(2000)
});

// Helper to check valid messaging relationship
const hasValidRelationship = (userId: string, otherUserId: string, userRole: string): boolean => {
  if (userRole === 'admin') return true; // Admins can message anyone
  
  if (userRole === 'tutor') {
    const stmt = db.prepare(`
      SELECT 1 FROM students 
      WHERE tutor_id = ? AND (student_user_id = ? OR parent_id = ?)
      LIMIT 1
    `);
    return !!stmt.get(userId, otherUserId, otherUserId);
  } else if (userRole === 'student') {
    const stmt = db.prepare(`
      SELECT 1 FROM students 
      WHERE student_user_id = ? AND tutor_id = ?
      LIMIT 1
    `);
    return !!stmt.get(userId, otherUserId);
  } else if (userRole === 'parent') {
    const stmt = db.prepare(`
      SELECT 1 FROM students 
      WHERE parent_id = ? AND tutor_id = ?
      LIMIT 1
    `);
    return !!stmt.get(userId, otherUserId);
  }
  return false;
};

// Get all conversations (list of users with last message)
router.get("/conversations", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  
  const stmt = db.prepare(`
    WITH LastMessages AS (
      SELECT 
        CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END as other_user_id,
        MAX(created_at) as max_created_at,
        MAX(id) as max_id
      FROM messages
      WHERE sender_id = ? OR receiver_id = ?
      GROUP BY other_user_id
    )
    SELECT 
      u.id, 
      u.name, 
      u.role,
      m.content as last_message,
      m.created_at as last_message_time,
      m.sender_id,
      (SELECT COUNT(*) FROM messages WHERE sender_id = u.id AND receiver_id = ? AND read_at IS NULL) as unread_count
    FROM users u
    JOIN LastMessages lm ON u.id = lm.other_user_id
    JOIN messages m ON m.id = lm.max_id
    WHERE u.id != ?
    ORDER BY last_message_time DESC, m.id DESC
  `);
  
  const conversations = stmt.all(userId, userId, userId, userId, userId);
  res.json(conversations);
});

// Get potential contacts (students/parents for tutor, tutor for students/parents)
router.get("/contacts/list", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const userRole = req.user?.role;

  let query = "";
  let params: any[] = [];

  if (userRole === 'tutor') {
    // Tutors can message their students and parents
    query = `
      SELECT DISTINCT u.id, u.name, u.role 
      FROM users u
      JOIN students s ON (s.student_user_id = u.id OR s.parent_id = u.id)
      WHERE s.tutor_id = ?
    `;
    params = [userId];
  } else if (userRole === 'student') {
    // Students can message their tutor
    query = `
      SELECT u.id, u.name, u.role 
      FROM users u
      JOIN students s ON s.tutor_id = u.id
      WHERE s.student_user_id = ?
    `;
    params = [userId];
  } else if (userRole === 'parent') {
    // Parents can message the tutor
    query = `
      SELECT u.id, u.name, u.role 
      FROM users u
      JOIN students s ON s.tutor_id = u.id
      WHERE s.parent_id = ?
    `;
    params = [userId];
  }

  if (query) {
    const contacts = db.prepare(query).all(...params);
    res.json(contacts);
  } else {
    res.json([]);
  }
});

// Get messages with a specific user
router.get("/:otherUserId", (req: AuthRequest, res) => {
  const userId = req.user?.id;
  const userRole = req.user?.role;
  const otherUserId = req.params.otherUserId;

  if (!userId || !userRole || !hasValidRelationship(userId, otherUserId, userRole)) {
    return res.status(403).json({ error: "Forbidden: No messaging relationship" });
  }

  const stmt = db.prepare(`
    SELECT * FROM messages 
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
    ORDER BY created_at ASC
  `);
  
  const messages = stmt.all(userId, otherUserId, otherUserId, userId);
  
  // Mark messages as read
  const updateStmt = db.prepare(`
    UPDATE messages 
    SET read_at = CURRENT_TIMESTAMP 
    WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL
  `);
  updateStmt.run(otherUserId, userId);

  res.json(messages);
});

// Send a message
router.post("/", (req: AuthRequest, res) => {
  try {
    const validatedData = messageSchema.parse(req.body);
    const { receiver_id, content } = validatedData;
    const senderId = req.user?.id;
    const userRole = req.user?.role;

    if (!senderId || !userRole || !hasValidRelationship(senderId, receiver_id, userRole)) {
      return res.status(403).json({ error: "Forbidden: No messaging relationship" });
    }

    const stmt = db.prepare(`
      INSERT INTO messages (sender_id, receiver_id, content)
      VALUES (?, ?, ?)
    `);
    const result = stmt.run(senderId, receiver_id, content);
    
    const newMessage = db.prepare("SELECT * FROM messages WHERE id = ?").get(result.lastInsertRowid);
    res.json(newMessage);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.issues });
    }
    console.error("Failed to send message", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

export default router;
