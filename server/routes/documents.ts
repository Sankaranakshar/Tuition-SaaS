import express from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { z } from "zod";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";

// Documents used to be base64-encoded straight into a Firestore field
// (fileUrl), never touching Cloud Storage at all: no org-isolated storage
// path, no size ceiling beyond Firestore's 1MB document cap, no content
// verification beyond a client-declared MIME type. This replaces that with
// a server-mediated upload to Supabase Storage (DEV_PLAN E3.9): the server
// sniffs the real file signature before trusting the declared type,
// sanitizes the filename, and the client only ever gets a short-lived
// signed URL, never a permanent public link.
const router = express.Router();
router.use(authenticateToken, requireOrg);

const BUCKET = "documents";
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
  if (sample.length > 0 && !sample.includes(0) && /^[\x09\x0A\x0D\x20-\x7E -￿]*$/.test(sample.toString("utf-8"))) {
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
  studentId: z.string().uuid(),
  category: z.string().min(1),
  notes: z.string().optional().default(""),
});

router.post("/", requireRole(...CAN_UPLOAD), upload.single("file"), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: { code: "no_file", message: "No file uploaded" } });

    const body = metaSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const sniffed = sniffContentType(req.file.buffer);
    if (!sniffed) {
      return res.status(422).json({ error: { code: "unsupported_type", message: "File content doesn't match a supported document type (PDF, PNG, JPEG, DOC, DOCX, or plain text)" } });
    }

    const safeName = sanitizeFilename(req.file.originalname);
    const storagePath = `orgs/${orgId}/documents/${body.studentId}/${Date.now()}-${randomUUID()}-${safeName}`;
    const { error: uploadErr } = await supabaseAdmin.storage.from(BUCKET).upload(storagePath, req.file.buffer, {
      contentType: sniffed,
      metadata: { uploadedBy: req.user!.id, organizationId: orgId },
    });
    if (uploadErr) throw uploadErr;

    const { data: doc, error: insertErr } = await supabaseAdmin.from("documents").insert({
      organization_id: orgId,
      tutor_id: req.user!.role === "tutor" ? req.user!.id : null,
      student_id: body.studentId,
      file_name: safeName,
      storage_path: storagePath,
      content_type: sniffed,
      category: body.category,
      notes: body.notes,
      uploaded_by_user_id: req.user!.id,
    }).select("id").single();
    if (insertErr) throw insertErr;

    await writeAudit(orgId, req.user!.id, "document.upload", "documents", doc.id, { fileName: safeName, category: body.category });
    res.json({ ok: true, documentId: doc.id });
  } catch (err) { next(err); }
});

router.get("/:documentId/url", async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const { data: doc, error } = await supabaseAdmin
      .from("documents").select("organization_id, storage_path, uploaded_by_user_id")
      .eq("id", req.params.documentId).maybeSingle();
    if (error) throw error;
    if (!doc) return res.status(404).json({ error: { code: "not_found", message: "Document not found" } });
    if (doc.organization_id !== orgId) return res.status(403).json({ error: { code: "forbidden", message: "Document belongs to another organization" } });
    if (!doc.storage_path) return res.status(422).json({ error: { code: "legacy_document", message: "This document predates Cloud Storage and has no signed-URL path" } });

    const isStaff = ["owner", "admin", "tutor", "frontdesk"].includes(req.user!.role || "");
    if (!isStaff && doc.uploaded_by_user_id !== req.user!.id) {
      return res.status(403).json({ error: { code: "forbidden", message: "Not authorized to view this document" } });
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET).createSignedUrl(doc.storage_path, 15 * 60);
    if (signErr) throw signErr;
    res.json({ ok: true, url: signed.signedUrl });
  } catch (err) { next(err); }
});

router.delete("/:documentId", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const { data: doc, error } = await supabaseAdmin
      .from("documents").select("organization_id, storage_path").eq("id", req.params.documentId).maybeSingle();
    if (error) throw error;
    if (!doc) return res.status(404).json({ error: { code: "not_found", message: "Document not found" } });
    if (doc.organization_id !== orgId) return res.status(403).json({ error: { code: "forbidden", message: "Document belongs to another organization" } });

    if (doc.storage_path) {
      await supabaseAdmin.storage.from(BUCKET).remove([doc.storage_path]);
    }
    const { error: delErr } = await supabaseAdmin.from("documents").delete().eq("id", req.params.documentId);
    if (delErr) throw delErr;
    await writeAudit(orgId, req.user!.id, "document.delete", "documents", req.params.documentId, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
