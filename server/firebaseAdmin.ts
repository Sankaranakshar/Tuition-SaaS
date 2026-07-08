import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import fs from "fs";
import path from "path";

let app;
let databaseId = "(default)";
let projectId;

try {
  const configPath = path.resolve(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    projectId = config.projectId;
    if (config.firestoreDatabaseId) {
      databaseId = config.firestoreDatabaseId;
    }
  }
} catch (error) {
  console.warn("Could not read firebase-applet-config.json", error);
}

if (!getApps().length) {
  try {
    app = initializeApp({ projectId });
  } catch (error) {
    console.warn("Failed to initialize Firebase Admin with default credentials. Using mock for development.");
  }
} else {
  app = getApp();
}

export const adminAuth = app ? getAuth(app) : null;
export const adminDb = app ? getFirestore(app, databaseId) : null;
export const adminStorage = app ? getStorage(app) : null;
