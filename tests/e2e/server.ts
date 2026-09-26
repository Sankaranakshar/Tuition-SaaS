import path from "node:path";
import express from "express";
import { createApp } from "../../server/app.ts";

// The server the Playwright suite drives. It reproduces production's shape on
// Vercel (vercel.json's routes) rather than `node dist/server.js`:
//   /api/*   -> the same Express app server/vercelHandler.ts exports
//   files    -> the built SPA in dist/, served as plain static files
//   anything else -> dist/index.html
//
// Why not `node dist/server.js` (the Dockerfile's entry point)? With
// NODE_ENV=production it serves the SPA under helmet's default
// Content-Security-Policy, whose connect-src 'self' blocks every browser call
// to Supabase, so nobody can sign in. Production on Vercel is unaffected
// (static files there carry no CSP header), so testing through that path
// would test a deployment nobody uses. Recorded in EXECUTION_PLAN.md Step 31.

const port = Number(process.env.PORT) || 3201;
const dist = path.resolve("dist");

const app = express();
const api = createApp();
app.use((req, res, next) => (req.path.startsWith("/api/") ? api(req, res, next) : next()));
app.use(express.static(dist, { index: false }));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

app.listen(port, "127.0.0.1", () => console.log(`[e2e] serving dist/ + API on http://localhost:${port}`));
