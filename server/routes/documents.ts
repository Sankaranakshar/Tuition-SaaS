import express from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { z } from "zod";
import { adminDb, adminStorage } from "../firebaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";

// Documents used to be base64-encoded straight into a Firestore field
// (fileUrl), never touching Cloud Storage at all: no org-isolated storage
// path, no size ceiling beyond Firestore's 1MB document cap, no content
// verification beyond a client-declared MIME type. This replaces that with
// a server-mediated upload to Cloud Storage (DEV_PLAN E3.9): the server
// sniffs the real file signature before trusting the declared type,
// sanitizes the filename, and the client only ever gets a short-lived
// signed URL, never a permanent public link.
const router = express.Router();
router.use(authenticateToken, requireOrg);

const CAN_UPLOAD = ["owner", "admin", "tutor", "frontdesk"] as const;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const MAGIC_BYTES: { contentType: string; signatures: number[][] }[] = [
  { contentType: "application/pdf", signatures: [[0x25, 0x50, 0x44, 0x46]] }, // %PDF
  { contentType: "image/png", signatures: [[0x89, 0x50, 0x4e, 0x47]] },
  { contentType: "image/jpeg", signatures: [[0xff, 0xd8, 0xff]] },
  // .doc (OLE compound file) and .docx (zip/PK) share these prefixes.
  { contentType: "application/msword", signatures: [[0xd0, 0xcf, 0x11, 0xe0]] },
  { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", signatures: [[0x50, 0x4b, 0x03, 0x04]] },
];

function sniffContentType(buffer: Buffer): string | null {
  for (const { contentType, signatures } of MAGIC_BYTES) {
    if (signatures.some((sig) => sig.every((byte, i) => buffer[i] === byte))) return contentType;
  }
  // text/plain has no magic number; accept only if it decodes as clean UTF-8/ASCII text.
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  if (sample.length > 0 && !sample.includes(0) && /^[\x09\x0A\x0D\x20-\x7E -￿]*$/.test(sample.toString("utf-8"))) {
    return "text/plain";
  }
  return null;
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/^.*[\\/]/, ""); // strip any path component
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150);
  return cleaned || "file";
}

const metaSchema = z.object({
  studentId: z.string().min(1),
  category: z.string().min(1),
  notes: z.string().optional().default(""),
});

router.post("/", requireRole(...CAN_UPLOAD), upload.single("file"), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb || !adminStorage) throw new Error("Firebase Admin not initialized");
    if (!req.file) return res.status(400).json({ error: { code: "no_file", message: "No file uploaded" } });

    const body = metaSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const sniffed = sniffContentType(req.file.buffer);
    if (!sniffed) {
      return res.status(422).json({ error: { code: "unsupported_type", message: "File content doesn't match a supported document type (PDF, PNG, JPEG, DOC, DOCX, or plain text)" } });
    }

    const safeName = sanitizeFilename(req.file.originalname);
    const storagePath = `orgs/${orgId}/documents/${body.studentId}/${Date.now()}-${randomUUID()}-${safeName}`;
    const bucket = adminStorage.bucket();
    await bucket.file(storagePath).save(req.file.buffer, {
      contentType: sniffed,
      metadata: { metadata: { uploadedBy: req.user!.id, organizationId: orgId } },
    });

    const docRef = await adminDb.collection("documents").add({
      organizationId: orgId,
      tutorId: req.user!.role === "tutor" ? req.user!.id : null,
      studentId: body.studentId,
      fileName: safeName,
      storagePath,
      contentType: sniffed,
      category: body.category,
      notes: body.notes,
      uploadedBy: req.user!.id,
      uploadedByUserId: req.user!.id,
      createdAt: new Date(),
    });

    await writeAudit(orgId, req.user!.id, "document.upload", "documents", docRef.id, { fileName: safeName, category: body.category });
    res.json({ ok: true, documentId: docRef.id });
  } catch (err) { next(err); }
});

router.get("/:documentId/url", async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb || !adminStorage) throw new Error("Firebase Admin not initialized");
    const orgId = req.user!.organizationId!;
    const snap = await adminDb.collection("documents").doc(req.params.documentId).get();
    if (!snap.exists) return res.status(404).json({ error: { code: "not_found", message: "Document not found" } });
    const doc = snap.data()!;
    if (doc.organizationId !== orgId) return res.status(403).json({ error: { code: "forbidden", message: "Document belongs to another organization" } });
    if (!doc.storagePath) return res.status(422).json({ error: { code: "legacy_document", message: "This document predates Cloud Storage and has no signed-URL path" } });

    const isStaff = ["owner", "admin", "tutor", "frontdesk"].includes(req.user!.role || "");
    if (!isStaff && doc.uploadedByUserId !== req.user!.id) {
      return res.status(403).json({ error: { code: "forbidden", message: "Not authorized to view this document" } });
    }

    const [url] = await adminStorage.bucket().file(doc.storagePath).getSignedUrl({
      action: "read",
      expires: Date.now() + 15 * 60 * 1000,
    });
    res.json({ ok: true, url });
  } catch (err) { next(err); }
});

router.delete("/:documentId", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb || !adminStorage) throw new Error("Firebase Admin not initialized");
    const orgId = req.user!.organizationId!;
    const ref = adminDb.collection("documents").doc(req.params.documentId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: { code: "not_found", message: "Document not found" } });
    const doc = snap.data()!;
    if (doc.organizationId !== orgId) return res.status(403).json({ error: { code: "forbidden", message: "Document belongs to another organization" } });

    if (doc.storagePath) {
      await adminStorage.bucket().file(doc.storagePath).delete({ ignoreNotFound: true });
    }
    await ref.delete();
    await writeAudit(orgId, req.user!.id, "document.delete", "documents", req.params.documentId, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
