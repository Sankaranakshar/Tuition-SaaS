import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp } from "./server/app.ts";

// Local dev + traditional (non-serverless) hosting entry point. Wraps the shared
// Express app from server/app.ts with a Vite dev middleware (dev) or static SPA
// serving (prod), then listens. On Vercel this file is NOT used — api/index.ts is
// the serverless entry and Vercel serves the built SPA statically.
async function startServer() {
  const app = createApp();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === "production";

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
