import { z } from "zod";

// Request/response contracts for server/routes/billing.ts, shared so the
// server can validate with the same schema the client infers its types from
// (DEV_PLAN §2a Step 0.2 / HANDOFF §17.3). Money fields are paise (integer)
// unless a comment says otherwise; keep it that way — see invariant #4.

const paymentMethodSchema = z.enum(["cash", "upi", "bank_transfer", "cheque", "other"]);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const createInvoiceRequestSchema = z.object({
  studentId: z.string().uuid(),
  items: z.array(z.object({
    description: z.string().min(1),
    amount: z.number().nonnegative(), // rupees, as entered in the line-item form
    quantity: z.number().int().positive(),
  })).min(1),
  taxPercentage: z.number().min(0).max(100).optional().default(0),
  dueDate: z.string().optional(),
});
export type CreateInvoiceRequest = z.infer<typeof createInvoiceRequestSchema>;
export const createInvoiceResponseSchema = z.object({ ok: z.literal(true), invoiceId: z.string().uuid() });
export type CreateInvoiceResponse = z.infer<typeof createInvoiceResponseSchema>;

export const topupRequestSchema = z.object({
  studentId: z.string().uuid(),
  amountPaise: z.number().int().positive(),
  method: paymentMethodSchema,
  idempotencyKey: z.string().min(8).max(128),
  note: z.string().max(500).optional(),
});
export type TopupRequest = z.infer<typeof topupRequestSchema>;
export const topupResponseSchema = z.object({ ok: z.literal(true), duplicate: z.boolean() });
export type TopupResponse = z.infer<typeof topupResponseSchema>;

const attendanceStatusSchema = z.enum(["present", "absent", "late", "excused"]);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export const markAttendanceRequestSchema = z.object({
  sessionId: z.string().uuid(),
  records: z.array(z.object({
    studentId: z.string().uuid(),
    status: attendanceStatusSchema,
  })).min(1),
});
export type MarkAttendanceRequest = z.infer<typeof markAttendanceRequestSchema>;
export const markAttendanceResponseSchema = z.object({
  ok: z.literal(true),
  billed: z.array(z.string()),
  invoiced: z.array(z.string()),
});
export type MarkAttendanceResponse = z.infer<typeof markAttendanceResponseSchema>;

export const cancelSessionRequestSchema = z.object({ sessionId: z.string().uuid() });
export type CancelSessionRequest = z.infer<typeof cancelSessionRequestSchema>;
export const cancelSessionResponseSchema = z.object({ ok: z.literal(true) });
export type CancelSessionResponse = z.infer<typeof cancelSessionResponseSchema>;

export const recordManualPaymentRequestSchema = z.object({
  invoiceId: z.string().uuid(),
  amountPaise: z.number().int().positive(),
  method: paymentMethodSchema,
  idempotencyKey: z.string().min(8).max(128),
  note: z.string().max(500).optional(),
});
export type RecordManualPaymentRequest = z.infer<typeof recordManualPaymentRequestSchema>;
export const recordManualPaymentResponseSchema = z.object({
  ok: z.literal(true),
  invoiceStatus: z.string(),
  duplicate: z.boolean(),
});
export type RecordManualPaymentResponse = z.infer<typeof recordManualPaymentResponseSchema>;

export const refundRequestSchema = z.object({
  invoiceId: z.string().uuid(),
  amountPaise: z.number().int().positive(),
  reason: z.string().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128),
});
export type RefundRequest = z.infer<typeof refundRequestSchema>;
export const refundResponseSchema = z.object({
  ok: z.literal(true),
  invoiceStatus: z.string(),
  duplicate: z.boolean(),
});
export type RefundResponse = z.infer<typeof refundResponseSchema>;

export const voidInvoiceResponseSchema = z.object({ ok: z.literal(true) });
export type VoidInvoiceResponse = z.infer<typeof voidInvoiceResponseSchema>;

export const finalizeInvoiceResponseSchema = z.object({ ok: z.literal(true), invoiceNumber: z.string() });
export type FinalizeInvoiceResponse = z.infer<typeof finalizeInvoiceResponseSchema>;

export const paymentLinkResponseSchema = z.object({ ok: z.literal(true), shortUrl: z.string(), reused: z.boolean() });
export type PaymentLinkResponse = z.infer<typeof paymentLinkResponseSchema>;
