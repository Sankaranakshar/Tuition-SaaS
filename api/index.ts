// Vercel serverless entry point. Vercel deploys any file under /api as a
// function; exporting the configured Express app as the default export lets
// Vercel route matched requests (see vercel.json rewrites) straight into it.
// The SPA is served statically by Vercel from the Vite build output (dist),
// so this handler only ever serves /api/* routes.
import { createApp } from "../server/app.ts";

const app = createApp();

export default app;
