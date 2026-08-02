import { z } from "zod";

// Request contracts for server/routes/gateway.ts (DEV_PLAN Tech Debt #8).

export const gatewayCredsRequestSchema = z.object({
  keyId: z.string().min(6),
  keySecret: z.string().min(6),
  webhookSecret: z.string().min(6),
});
export type GatewayCredsRequest = z.infer<typeof gatewayCredsRequestSchema>;

export const gatewayTaxRequestSchema = z.object({
  legalName: z.string().max(200).optional(),
  gstin: z.string().max(20).optional(),
  addressLines: z.array(z.string().max(200)).max(5).optional(),
  placeOfSupply: z.string().max(60).optional(),
  defaultTaxRatePercent: z.number().min(0).max(28).optional(),
  invoicePrefix: z.string().max(8).optional(),
});
export type GatewayTaxRequest = z.infer<typeof gatewayTaxRequestSchema>;
