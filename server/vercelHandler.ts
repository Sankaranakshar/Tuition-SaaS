// Source for the Vercel serverless function. Not deployed as-is: Vercel's
// default per-file TypeScript builder does NOT bundle relative imports across
// directories (e.g. this file's `./app.ts`) — a deployed function importing
// "../server/app.ts" fails at runtime with ERR_MODULE_NOT_FOUND because the
// .ts source file isn't shipped and Node can't load .ts directly anyway.
// vercel.json's buildCommand instead esbuild-bundles this file (inlining
// app.ts and everything it imports, keeping npm packages external) into a
// single self-contained api/index.js, which is what Vercel actually deploys.
import { createApp } from "./app.ts";

const app = createApp();

export default app;
