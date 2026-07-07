import express from "express";
import { createServer as createViteServer } from "vite";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pino from "pino-http";
import { initDb } from "./server/db.ts";
import authRoutes from "./server/routes/auth.ts";
import studentRoutes from "./server/routes/students.ts";
import classRoutes from "./server/routes/classes.ts";
import documentRoutes from "./server/routes/documents.ts";
import invoiceRoutes from "./server/routes/invoices.ts";
import settingsRoutes from "./server/routes/settings.ts";
import dashboardRoutes from "./server/routes/dashboard.ts";
import messageRoutes from "./server/routes/messages.ts";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize DB
  initDb();

  // Security Middleware
  const isProd = process.env.NODE_ENV === "production";
  
  // Structured Logging
  app.use(pino({
    level: isProd ? 'info' : 'debug',
    transport: isProd ? undefined : {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  }));

  app.use(helmet({
    contentSecurityPolicy: isProd ? undefined : false, // Disable CSP for Vite dev server to work properly
    crossOriginEmbedderPolicy: isProd ? undefined : false,
  }));
  
  app.use(cors({
    origin: process.env.NODE_ENV === "production" ? process.env.APP_URL : "http://localhost:3000",
    credentials: true,
  }));

  // Trust proxy for rate limiting behind reverse proxy
  app.set('trust proxy', 1);

  // Rate limiting
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 requests per window for auth routes
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many authentication attempts, please try again after 15 minutes" }
  });

  app.use(express.json());
  app.use(cookieParser());

  // Apply rate limiting to API routes
  app.use("/api/", apiLimiter);
  app.use("/api/auth/", authLimiter);

  // API routes
  app.use("/api/auth", authRoutes);
  app.use("/api/students", studentRoutes);
  app.use("/api/classes", classRoutes);
  app.use("/api/documents", documentRoutes);
  app.use("/api/invoices", invoiceRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/messages", messageRoutes);

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const path = await import("path");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
