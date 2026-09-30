// Gemeinsame Helfer für die Health-API (Vercel Serverless Functions).
// Benötigte Environment-Variablen in Vercel:
//   FIREBASE_SERVICE_ACCOUNT – kompletter JSON-Inhalt des Firebase-Dienstkonto-Schlüssels
//   HEALTH_SECRET            – beliebiger langer Zufallsstring (signiert die Nutzer-Tokens)
import admin from "firebase-admin";
import crypto from "node:crypto";

export const getAdmin = () => {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt");
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  return admin;
};

const sign = (uid) => {
  const secret = process.env.HEALTH_SECRET;
  if (!secret) throw new Error("HEALTH_SECRET fehlt");
  return crypto.createHmac("sha256", secret).update("health:" + uid).digest("base64url").slice(0, 32);
};

// Token-Format: <uid>.<hmac> – kein DB-Lookup nötig, nicht fälschbar ohne HEALTH_SECRET.
export const makeToken = (uid) => `${uid}.${sign(uid)}`;
export const uidFromToken = (token) => {
  if (!token || typeof token !== "string") return null;
  const i = token.lastIndexOf(".");
  if (i < 1) return null;
  const uid = token.slice(0, i), mac = token.slice(i + 1);
  const expected = sign(uid);
  if (mac.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? uid : null;
};

export const cors = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
};
