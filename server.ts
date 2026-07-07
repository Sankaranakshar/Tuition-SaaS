import express from "express";
import { createServer as createViteServer } from "vite";
import helmet from "helmet";
import cors from "cors";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import pino from "pino-http";
import settingsRoutes from "./server/routes/settings.ts";
import membersRoutes from "./server/routes/members.ts";
import billingRoutes from "./server/routes/billing.ts";
import type { AuthRequest } from "./server/middleware/auth.ts";

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
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
  // Temporary alias while the frontend migrates to /api/v1.
  app.use("/api/settings", settingsRoutes);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // JSON 404 for unknown API routes (must precede the SPA catch-all).
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
    res.status(status).json({ error: { code, message: status === 500 ? "Internal Server Error" : err.message } });
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const path = await import("path");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

startServer();
