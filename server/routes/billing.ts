import express from "express";
import { z } from "zod";
import { adminDb } from "../firebaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";

const router = express.Router();
router.use(authenticateToken, requireOrg);

const CAN_MARK = ["owner", "admin", "tutor", "frontdesk"] as const;
const CAN_MONEY = ["owner", "admin", "frontdesk"] as const;

const attendanceSchema = z.object({
  sessionId: z.string().min(1),
  records: z.array(z.object({
    studentId: z.string().min(1),
    status: z.enum(["present", "absent", "late", "excused"]),
  })).min(1),
});

// Marks attendance for a session and settles per-session billing atomically.
// Idempotent: attendance doc IDs are `${sessionId}_${studentId}`, and billing
// only fires on the first transition into a billable status.
router.post("/attendance", requireRole(...CAN_MARK), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const { sessionId, records } = attendanceSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const actor = req.user!.id;

    const sessionRef = db.collection("class_sessions").doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      return res.status(404).json({ error: { code: "not_found", message: "Session not found" } });
    }
    const session = sessionSnap.data()!;
    if (session.organizationId !== orgId) {
      return res.status(403).json({ error: { code: "forbidden", message: "Session belongs to another organization" } });
    }
    // Tutors may only mark their own sessions; admin-tier roles may mark any.
    if (req.user!.role === "tutor" && session.tutorId !== actor) {
      return res.status(403).json({ error: { code: "forbidden", message: "Tutors can only mark their own sessions" } });
    }
    // Backdated marking allowed up to 7 days (audited); future sessions blocked.
    const start = new Date(session.startTime?.toDate ? session.startTime.toDate() : session.startTime);
    if (start.getTime() > Date.now()) {
      return res.status(422).json({ error: { code: "session_in_future", message: "Cannot mark attendance before the session starts" } });
    }
    if (Date.now() - start.getTime() > 7 * 24 * 3600 * 1000) {
      return res.status(422).json({ error: { code: "too_old", message: "Attendance can only be marked within 7 days of the session" } });
    }

    const templateSnap = await db.collection("class_templates").doc(session.templateId).get();
    const template = templateSnap.exists ? templateSnap.data()! : null;
    const perSession = template?.pricingModel === "PER_SESSION";
    const BILLABLE = new Set(["present", "late"]);

    // Pre-resolve wallet refs (reads before writes inside the transaction).
    const walletRefByStudent = new Map<string, FirebaseFirestore.DocumentReference>();
    if (perSession) {
      for (const r of records) {
        const ws = await db.collection("wallets")
          .where("organizationId", "==", orgId)
          .where("studentId", "==", r.studentId)
          .limit(1).get();
        if (!ws.empty) walletRefByStudent.set(r.studentId, ws.docs[0].ref);
      }
    }

    const result = await db.runTransaction(async (tx) => {
      const billed: string[] = [];
      const invoiced: string[] = [];

      // Read phase
      const attRefs = records.map((r) => db.collection("attendance_records").doc(`${sessionId}_${r.studentId}`));
      const attSnaps = await Promise.all(attRefs.map((ref) => tx.get(ref)));
      const walletSnaps = new Map<string, FirebaseFirestore.DocumentSnapshot>();
      for (const [studentId, ref] of walletRefByStudent) {
        walletSnaps.set(studentId, await tx.get(ref));
      }

      // Write phase
      records.forEach((r, i) => {
        const prev = attSnaps[i].exists ? attSnaps[i].data()! : null;
        const alreadyBilled = prev?.billed === true;
        const nowBillable = perSession && BILLABLE.has(r.status);
        const shouldBill = nowBillable && !alreadyBilled;

        tx.set(attRefs[i], {
          organizationId: orgId,
          sessionId,
          studentId: r.studentId,
          templateId: session.templateId,
          tutorId: session.tutorId,
          sessionStart: session.startTime,
          status: r.status,
          billed: alreadyBilled || shouldBill,
          markedBy: actor,
          markedAt: new Date(),
        }, { merge: true });

        if (shouldBill) {
          const feePaise = Math.round((template!.feeAmount || 0) * 100);
          const wSnap = walletSnaps.get(r.studentId);
          const w = wSnap?.exists ? wSnap.data()! : null;

          if (w && (w.balanceCredits || 0) >= 1) {
            tx.update(walletRefByStudent.get(r.studentId)!, { balanceCredits: (w.balanceCredits || 0) - 1 });
            tx.set(db.collection("wallet_ledger").doc(), {
              organizationId: orgId, studentId: r.studentId, type: "debit_credit",
              credits: -1, paise: 0, reason: "attendance", sessionId, at: new Date(), by: actor,
            });
            billed.push(r.studentId);
          } else if (w && Math.round((w.balanceCurrency || 0) * 100) >= feePaise) {
            tx.update(walletRefByStudent.get(r.studentId)!, { balanceCurrency: (Math.round((w.balanceCurrency || 0) * 100) - feePaise) / 100 });
            tx.set(db.collection("wallet_ledger").doc(), {
              organizationId: orgId, studentId: r.studentId, type: "debit_currency",
              credits: 0, paise: -feePaise, reason: "attendance", sessionId, at: new Date(), by: actor,
            });
            billed.push(r.studentId);
          } else {
            // Insufficient balance: accrue an unpaid invoice, exactly once
            // (guarded by the `billed` flag on the attendance record).
            const due = new Date(Date.now() + 7 * 24 * 3600 * 1000);
            tx.set(db.collection("invoices").doc(), {
              organizationId: orgId,
              tutorId: session.tutorId,
              studentId: r.studentId,
              subtotalPaise: feePaise,
              totalPaise: feePaise,
              taxPaise: 0,
              discountPaise: 0,
              // Legacy rupee fields kept until the frontend migrates.
              totalAmount: feePaise / 100,
              subtotal: feePaise / 100,
              status: "unpaid",
              dueDate: due.toISOString().split("T")[0],
              items: [{ description: `${template!.type} session on ${start.toISOString().split("T")[0]}`, amountPaise: feePaise, quantity: 1 }],
              source: { kind: "attendance", sessionId },
              createdAt: new Date(),
            });
            invoiced.push(r.studentId);
          }
        }
      });

      tx.update(sessionRef, { status: "completed", attendanceMarkedAt: new Date(), attendanceMarkedBy: actor });
      return { billed, invoiced };
    });

    await writeAudit(orgId, actor, "attendance.mark", "class_sessions", sessionId, {
      records: records.map((r) => `${r.studentId}:${r.status}`),
      ...result,
    });
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

const cancelSchema = z.object({ sessionId: z.string().min(1) });

router.post("/sessions/cancel", requireRole(...CAN_MARK), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const { sessionId } = cancelSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const ref = adminDb.collection("class_sessions").doc(sessionId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()!.organizationId !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Session not found" } });
    }
    if (req.user!.role === "tutor" && snap.data()!.tutorId !== req.user!.id) {
      return res.status(403).json({ error: { code: "forbidden", message: "Tutors can only cancel their own sessions" } });
    }
    await ref.update({ status: "cancelled", cancelledAt: new Date(), cancelledBy: req.user!.id });
    await writeAudit(orgId, req.user!.id, "session.cancel", "class_sessions", sessionId, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amountPaise: z.number().int().positive(),
  method: z.enum(["cash", "upi", "bank_transfer", "cheque", "other"]),
  idempotencyKey: z.string().min(8).max(128),
  note: z.string().max(500).optional(),
});

// Record an offline payment against an invoice. Gateway payments arrive via
// webhooks (Stage 1 / Epic 6); both paths converge on the same ledger shape.
router.post("/payments/manual", requireRole(...CAN_MONEY), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const body = paymentSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const payRef = db.collection("payments").doc(body.idempotencyKey);
    const invRef = db.collection("invoices").doc(body.invoiceId);

    const outcome = await db.runTransaction(async (tx) => {
      const [paySnap, invSnap] = await Promise.all([tx.get(payRef), tx.get(invRef)]);
      if (paySnap.exists) return { duplicate: true, status: paySnap.data()!.invoiceStatus };
      if (!invSnap.exists || invSnap.data()!.organizationId !== orgId) {
        throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
      }
      const inv = invSnap.data()!;
      if (inv.status === "void") {
        throw Object.assign(new Error("Invoice is void"), { status: 422, code: "invoice_void" });
      }
      const totalPaise = inv.totalPaise ?? Math.round((inv.totalAmount || 0) * 100);
      const paidSoFar = inv.paidPaise || 0;
      const newPaid = paidSoFar + body.amountPaise;
      const status = newPaid >= totalPaise ? "paid" : "partially_paid";

      tx.set(payRef, {
        organizationId: orgId,
        invoiceId: body.invoiceId,
        studentId: inv.studentId,
        amountPaise: body.amountPaise,
        method: body.method,
        note: body.note || null,
        recordedBy: req.user!.id,
        invoiceStatus: status,
        at: new Date(),
      });
      tx.update(invRef, { paidPaise: newPaid, status, lastPaymentAt: new Date() });
      return { duplicate: false, status };
    });

    if (!outcome.duplicate) {
      await writeAudit(orgId, req.user!.id, "payment.record_manual", "invoices", body.invoiceId, {
        amountPaise: body.amountPaise, method: body.method,
      });
    }
    res.status(outcome.duplicate ? 200 : 201).json({ ok: true, invoiceStatus: outcome.status, duplicate: outcome.duplicate });
  } catch (err) { next(err); }
});

// Invoices are never deleted; they are voided, leaving the audit trail intact.
router.post("/invoices/:invoiceId/void", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const orgId = req.user!.organizationId!;
    const ref = adminDb.collection("invoices").doc(req.params.invoiceId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()!.organizationId !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Invoice not found" } });
    }
    if (snap.data()!.status === "paid") {
      return res.status(422).json({ error: { code: "already_paid", message: "Paid invoices cannot be voided; issue a refund instead" } });
    }
    await ref.update({ status: "void", voidedAt: new Date(), voidedBy: req.user!.id });
    await writeAudit(orgId, req.user!.id, "invoice.void", "invoices", req.params.invoiceId, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
