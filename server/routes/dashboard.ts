import express from "express";
import { db } from "../db.ts";
import { authenticateToken, requireRole, type AuthRequest } from "../middleware/auth.ts";

const router = express.Router();

router.use(authenticateToken);
router.use(requireRole("tutor"));

router.get("/", (req: AuthRequest, res) => {
  const tutorId = req.user?.id;
  const today = new Date().toISOString().split("T")[0];

  try {
    const activeStudents = db.prepare("SELECT COUNT(*) as count FROM students WHERE tutor_id = ? AND status = 'active'").get(tutorId) as any;
    const classesToday = db.prepare("SELECT COUNT(*) as count FROM classes WHERE tutor_id = ? AND date = ?").get(tutorId, today) as any;
    const pendingInvoices = db.prepare("SELECT SUM(amount) as total FROM invoices WHERE tutor_id = ? AND status = 'unpaid'").get(tutorId) as any;

    const upcomingClasses = db.prepare(`
      SELECT c.*, s.name as student_name 
      FROM classes c 
      JOIN students s ON c.student_id = s.id 
      WHERE c.tutor_id = ? AND c.date >= ?
      ORDER BY c.date ASC, c.start_time ASC
      LIMIT 5
    `).all(tutorId, today);

    // Get monthly revenue for the last 6 months
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    const startMonth = sixMonthsAgo.toISOString().slice(0, 7); // YYYY-MM

    const monthlyRevenue = db.prepare(`
      SELECT strftime('%Y-%m', issue_date) as month, SUM(amount) as total
      FROM invoices
      WHERE tutor_id = ? AND issue_date >= ? AND status = 'paid'
      GROUP BY month
      ORDER BY month ASC
    `).all(tutorId, `${startMonth}-01`);

    res.json({
      kpis: {
        activeStudents: activeStudents.count,
        classesToday: classesToday.count,
        pendingInvoiceAmount: pendingInvoices.total || 0
      },
      upcomingClasses,
      monthlyRevenue
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load dashboard data" });
  }
});

export default router;
