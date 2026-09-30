// Gibt dem eingeloggten Nutzer seinen persönlichen Health-Token für den iPhone-Kurzbefehl.
// Auth: Firebase-ID-Token im Authorization-Header.
import { getAdmin, makeToken, cors } from "./_lib.js";

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST erwartet" });
  try {
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!idToken) return res.status(401).json({ error: "Nicht eingeloggt" });
    const decoded = await getAdmin().auth().verifyIdToken(idToken);
    return res.status(200).json({ token: makeToken(decoded.uid) });
  } catch (e) {
    const cfg = /FIREBASE_SERVICE_ACCOUNT|HEALTH_SECRET/.test(e.message);
    return res.status(cfg ? 500 : 401).json({ error: cfg ? "Server nicht eingerichtet: " + e.message : "Ungültige Anmeldung" });
  }
}
