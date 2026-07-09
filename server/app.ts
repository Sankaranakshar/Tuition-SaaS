import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import pino from "pino-http";
import * as Sentry from "@sentry/node";
import settingsRoutes from "./routes/settings.ts";
import membersRoutes from "./routes/members.ts";
import billingRoutes from "./routes/billing.ts";
import gatewayRoutes from "./routes/gateway.ts";
import parentsRoutes from "./routes/parents.ts";
import webhookRoutes from "./routes/webhooks.ts";
import schedulingRoutes from "./routes/scheduling.ts";
import cronRoutes from "./routes/cron.ts";
import documentsRoutes from "./routes/documents.ts";
import type { AuthRequest } from "./middleware/auth.ts";

// Builds the configured Express app WITHOUT starting a listener or serving the
// SPA. Two consumers:
//   - server.ts (local dev / traditional host): adds Vite middleware + static
//     serving + app.listen().
//   - api/index.ts (Vercel serverless): exports this app as the function handler;
//     Vercel serves the built SPA statically, so no static/listen needed here.
export function createApp() {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: 0.1,
    });
  }

  const app = express();
  const isProd = process.env.NODE_ENV === "production";

  app.use(pino({
    level: isProd ? "info" : "debug",
    redact: ["req.headers.authorization", "req.headers.cookie"],
    transport: isProd ? undefined : {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }));

  app.use(helmet({
    contentSecurityPolicy: isProd ? undefined : false, // Vite dev server needs inline scripts
    crossOriginEmbedderPolicy: isProd ? undefined : false,
  }));

  app.use(cors({
    origin: isProd ? process.env.APP_URL : "http://localhost:3000",
    credentials: false, // header-based auth only; no cookies, no CSRF surface
  }));

  app.set("trust proxy", 1);

  // Payment webhooks mount FIRST: signature verification needs the exact raw
  // bytes (so no JSON parsing), and gateway retry bursts must not be
  // rate-limited. The router verifies the HMAC signature before trusting input.
  app.use("/api/webhooks", express.raw({ type: "*/*", limit: "1mb" }), webhookRoutes);

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    // Authenticated traffic is limited per user, not per shared NAT
    // (coaching centers share IPs). ipKeyGenerator handles IPv6 subnets.
    keyGenerator: (req) => (req as AuthRequest).user?.id || ipKeyGenerator(req.ip || ""),
  });

  app.use(express.json({ limit: "1mb" }));
  app.use("/api/", apiLimiter);

  // API v1
  app.use("/api/v1/settings", settingsRoutes);
  app.use("/api/v1/members", membersRoutes);
  app.use("/api/v1/billing", billingRoutes);
  app.use("/api/v1/gateway", gatewayRoutes);
  app.use("/api/v1/parents", parentsRoutes);
  app.use("/api/v1/scheduling", schedulingRoutes);
  app.use("/api/v1/documents", documentsRoutes);
  app.use("/api/cron", cronRoutes);
  // Temporary alias while the frontend migrates to /api/v1.
  app.use("/api/settings", settingsRoutes);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // JSON 404 for unknown API routes (must precede any SPA catch-all).
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Unknown API route" } });
  });

  // Central error handler: Zod errors → 422, tagged errors → their status,
  // everything else → sanitized 500.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.name === "ZodError") {
      return res.status(422).json({ error: { code: "validation", message: "Invalid request", details: err.issues } });
    }
    const status = typeof err?.status === "number" ? err.status : 500;
    const code = err?.code && typeof err.code === "string" ? err.code : "internal";
    (req as any).log?.error({ err }, "Unhandled API error");
    if (status >= 500) Sentry.captureException(err);
    res.status(status).json({ error: { code, message: status === 500 ? "Internal Server Error" : err.message } });
  });

  return app;
}
