import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './lib/i18n';
import './index.css';

// Dynamically imported: @sentry/react costs ~29KB gzip on the main entry
// chunk (measured, docs/OPTIMIZATION_AUDIT.md finding H5) and the DSN is
// unset until go-to-market (HANDOFF §7), so every user was downloading it
// for zero current functionality. The `if (dsn)` guard used to gate only
// initialisation, not download. Caveat: init is now async, so a crash in
// the first tick of startup (before this promise resolves) could go
// unreported — acceptable today since there's no DSN to report to yet.
const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  import('@sentry/react').then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
