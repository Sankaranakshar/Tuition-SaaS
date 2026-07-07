# ClassStackr

ClassStackr is an all-in-one platform for scheduling, online classes, billing, and student management for tutors.

## Architecture

- **Frontend**: React, Vite, Tailwind CSS, shadcn/ui.
- **Backend**: Express.js, SQLite (for legacy/custom data), Firebase Admin SDK.
- **Authentication**: Firebase Authentication (Frontend) + Firebase Admin SDK (Backend).
- **Database**: Firebase Firestore (Primary) + SQLite (Secondary/Legacy).

## Setup & Configuration

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

   Required variables:
   - `VITE_FIREBASE_API_KEY`: Firebase API Key
   - `VITE_FIREBASE_AUTH_DOMAIN`: Firebase Auth Domain
   - `VITE_FIREBASE_PROJECT_ID`: Firebase Project ID
   - `VITE_FIREBASE_STORAGE_BUCKET`: Firebase Storage Bucket
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`: Firebase Messaging Sender ID
   - `VITE_FIREBASE_APP_ID`: Firebase App ID
   - `GOOGLE_CLIENT_ID`: Google OAuth Client ID (for Calendar integration)
   - `GOOGLE_CLIENT_SECRET`: Google OAuth Client Secret

3. **Firebase Admin SDK**
   For the backend to verify Firebase tokens, ensure your environment supports Application Default Credentials or provide a service account key if running outside of GCP.

4. **Run Development Server**
   ```bash
   npm run dev
   ```

## Security

- **Auth**: The backend verifies Firebase ID tokens sent in the `Authorization: Bearer <token>` header or `token` cookie.
- **Middleware**: The Express server uses `helmet` for security headers, `cors` for cross-origin requests, and `express-rate-limit` to prevent abuse.
