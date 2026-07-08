import express from "express";
import { adminDb } from "../firebaseAdmin.ts";
import { materializeTemplate } from "./scheduling.ts";

// Machine-to-machine endpoints for Cloud Scheduler. No Firebase user token
// exists for a scheduler invocation, so these are gated by a shared secret
// instead of authenticateToken/requireOrg. Configure Cloud Scheduler to send
// `x-cron-secret: ${CRON_SECRET}` and point it at this route on a cadence
// shorter than WEEKS_AHEAD in scheduling.ts (e.g. daily) so the rolling
// session window never runs dry.
const router = express.Router();

router.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.header("x-cron-secret") !== secret) {
    return res.status(404).json({ error: { code: "not_found", message: "Not found" } });
  }
  next();
});

router.post("/materialize-sessions", async (_req, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const templatesSnap = await db.collection("class_templates").get();

    const aggregate = { created: [] as string[], conflicts: [] as { templateId: string; date: string }[], templatesProcessed: 0 };
    for (const templateDoc of templatesSnap.docs) {
      const r = await materializeTemplate(db, templateDoc.id, templateDoc.data());
      aggregate.created.push(...r.created);
      aggregate.conflicts.push(...r.conflicts);
      aggregate.templatesProcessed++;
    }
    res.json({ ok: true, ...aggregate });
  } catch (err) { next(err); }
});

export default router;
