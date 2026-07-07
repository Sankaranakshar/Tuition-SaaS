import express from "express";
import { db } from "../db.ts";
import { authenticateToken, requireRole, type AuthRequest } from "../middleware/auth.ts";
import { google } from "googleapis";
import { decrypt } from "../utils/crypto.ts";
import crypto from "crypto";
import { z } from "zod";

const router = express.Router();

router.use(authenticateToken);
router.use(requireRole("tutor"));

const classSchema = z.object({
  student_id: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format (YYYY-MM-DD)"),
  start_time: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format (HH:MM)"),
  end_time: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format (HH:MM)"),
  is_online: z.boolean()
});

router.get("/", (req: AuthRequest, res) => {
  const stmt = db.prepare(`
    SELECT c.*, s.name as student_name 
    FROM classes c 
    JOIN students s ON c.student_id = s.id 
    WHERE c.tutor_id = ?
    ORDER BY c.date ASC, c.start_time ASC
  `);
  const classes = stmt.all(req.user?.id);
  res.json(classes);
});

router.post("/", async (req: AuthRequest, res) => {
  try {
    const validatedData = classSchema.parse(req.body);
    const { student_id, date, start_time, end_time, is_online } = validatedData;
    const tutorId = req.user?.id;
    
    if (start_time >= end_time) {
      return res.status(400).json({ error: "Start time must be before end time" });
    }

    const student: any = db.prepare("SELECT tutor_id FROM students WHERE id = ?").get(student_id);
    if (!student || student.tutor_id !== tutorId) {
      return res.status(403).json({ error: "Unauthorized or student not found" });
    }

    // Check for tutor conflicts
    const tutorConflict = db.prepare(`
      SELECT 1 FROM classes 
      WHERE tutor_id = ? AND date = ? AND status != 'cancelled'
      AND (
        (start_time <= ? AND end_time > ?) OR
        (start_time < ? AND end_time >= ?) OR
        (start_time >= ? AND end_time <= ?)
      )
      LIMIT 1
    `).get(tutorId, date, start_time, start_time, end_time, end_time, start_time, end_time);

    if (tutorConflict) {
      return res.status(409).json({ error: "Tutor has an overlapping class at this time" });
    }

    // Check for student conflicts
    const studentConflict = db.prepare(`
      SELECT 1 FROM classes 
      WHERE student_id = ? AND date = ? AND status != 'cancelled'
      AND (
        (start_time <= ? AND end_time > ?) OR
        (start_time < ? AND end_time >= ?) OR
        (start_time >= ? AND end_time <= ?)
      )
      LIMIT 1
    `).get(student_id, date, start_time, start_time, end_time, end_time, start_time, end_time);

    if (studentConflict) {
      return res.status(409).json({ error: "Student has an overlapping class at this time" });
    }

    let meet_link = null;

    if (is_online) {
      try {
        const user: any = db.prepare("SELECT google_refresh_token FROM users WHERE id = ?").get(tutorId);
        if (user && user.google_refresh_token) {
          const decryptedToken = decrypt(user.google_refresh_token);
          if (decryptedToken) {
            const oauth2Client = new google.auth.OAuth2(
              process.env.GOOGLE_CLIENT_ID,
              process.env.GOOGLE_CLIENT_SECRET,
              `${process.env.APP_URL}/api/settings/google/callback`
            );
            oauth2Client.setCredentials({ refresh_token: decryptedToken });
            
            const calendar = google.calendar({ version: "v3", auth: oauth2Client });
            
            const event = {
              summary: "Tutoring Class",
              start: { dateTime: `${date}T${start_time}:00`, timeZone: "UTC" },
              end: { dateTime: `${date}T${end_time}:00`, timeZone: "UTC" },
              conferenceData: {
                createRequest: { requestId: `meet-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } }
              }
            };
            
            const response = await calendar.events.insert({
              calendarId: "primary",
              requestBody: event,
              conferenceDataVersion: 1
            });
            
            meet_link = response.data.hangoutLink;
          }
        }
      } catch (error) {
        console.error("Failed to create Google Meet link", error);
      }
    }

    const stmt = db.prepare(`
      INSERT INTO classes (tutor_id, student_id, date, start_time, end_time, is_online, meet_link)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(tutorId, student_id, date, start_time, end_time, is_online ? 1 : 0, meet_link);
    res.json({ message: "Class scheduled", id: result.lastInsertRowid, meet_link });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.issues });
    }
    res.status(500).json({ error: "Failed to schedule class" });
  }
});

router.put("/:id/status", (req: AuthRequest, res) => {
  const { status } = req.body;
  const validStatuses = ['scheduled', 'completed', 'no_show', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }
  const stmt = db.prepare("UPDATE classes SET status = ? WHERE id = ? AND tutor_id = ?");
  stmt.run(status, req.params.id, req.user?.id);
  res.json({ message: "Class status updated" });
});

export default router;
