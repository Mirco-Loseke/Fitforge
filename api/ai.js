// KI-Assistent: anbieter-unabhängiger Proxy. Der API-Schlüssel bleibt auf dem Server.
//
// Einrichtung (Vercel → Settings → Environment Variables):
//   AI_API_KEY    API-Schlüssel des Anbieters – das ist die EINZIGE Pflicht-Einstellung.
//                 Google-Schlüssel (beginnt mit "AIza") → Gemini wird automatisch genutzt.
//   AI_PROVIDER   optional: "gemini" | "anthropic" | "openai-compatible" (sonst automatisch erkannt)
//   AI_MODEL      optional; Standard: anthropic → claude-opus-5, gemini → neuestes verfügbares Flash-Modell
//   AI_BASE_URL   nur openai-compatible, z. B. https://api.openai.com/v1,
//                 https://generativelanguage.googleapis.com/v1beta/openai, https://openrouter.ai/api/v1
//   AI_EFFORT     optional (anthropic): low | medium | high – Standard medium (schnelle Antworten)
// Ohne AI_API_KEY antwortet der Endpunkt mit 501 → die App nutzt dann ihre lokale Befehlserkennung.
//
// POST /api/ai  Authorization: Bearer <Firebase-ID-Token>
// Body: { messages:[{role:"user"|"assistant", content}], context:{...}, task?: "chat"|"plan"|"meal"|"analyze" }
// Antwort: { reply: string, actions: [ {type, ...} ] }
import Anthropic from "@anthropic-ai/sdk";
import { cors } from "./_lib.js";

// Öffentlicher Firebase-Web-API-Key (steht ohnehin in index.html) – prüft ID-Tokens ohne Admin-SDK.
const FIREBASE_WEB_KEY = process.env.FIREBASE_WEB_API_KEY || "AIzaSyBHcrBR0fWYVDkdWWAoVfvMEaN0CeoB52M";
async function verifyUser(idToken) {
  if (!idToken) return null;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_WEB_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  return j.users?.[0]?.localId || null;
}

const providerName = () => {
  const p = (process.env.AI_PROVIDER || "").toLowerCase();
  if (p) return p;
  const k = process.env.AI_API_KEY || "";
  if (k.startsWith("AIza")) return "gemini";
  if (k.startsWith("sk-ant-")) return "anthropic";
  return "openai-compatible";
};

// Gemini: Modelle der Reihe nach probieren, das erste funktionierende merken.
// Nicht jedes Modell ist mit jedem Schlüssel/Tarif nutzbar (z. B. 2.5-Flash nicht im kostenlosen Plan),
// deshalb wird bei "kein Kontingent / nicht erlaubt / unbekannt" automatisch das nächste versucht.
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
let geminiWorking = null;
const geminiCandidates = (ids) => {
  const clean = [...new Set(ids.map(id => String(id || "").replace(/^models\//, "")))];
  const ok = clean.filter(id => /^gemini-/.test(id) && /flash/.test(id) && !/(image|tts|audio|live|thinking|exp|preview|embedding|native)/.test(id));
  const ver = id => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
  // neueste Version zuerst; innerhalb einer Version: normales Flash vor Lite, "latest"-Aliase zuerst
  ok.sort((a, b) => ver(b) - ver(a) || (/lite/.test(a) - /lite/.test(b)) || (b.endsWith("latest") - a.endsWith("latest")));
  for (const alias of ["gemini-flash-latest", "gemini-flash-lite-latest"]) if (!ok.includes(alias)) ok.push(alias);
  return ok;
};
const pickGeminiModel = (ids) => geminiCandidates(ids)[0] || null;
async function geminiModelList() {
  if (process.env.AI_MODEL) return [process.env.AI_MODEL];
  if (geminiWorking) return [geminiWorking];
  try {
    const r = await fetch(`${GEMINI_BASE}/models`, { headers: { Authorization: `Bearer ${process.env.AI_API_KEY}` } });
    const j = await r.json();
    return geminiCandidates((j.data || []).map(m => m.id)).slice(0, 8);
  } catch { return ["gemini-flash-latest", "gemini-flash-lite-latest"]; }
}
// Fehler, bei denen ein anderes Modell helfen kann (kein Freikontingent, nicht freigeschaltet, unbekannt)
const modelUnusable = (e) => [403, 404].includes(e.status) || (e.status === 429 && /limit:\s*0|free.?tier|not.*available|quota.*model/i.test(e.message || "")) || (e.status === 400 && /model/i.test(e.message || ""));
async function callGemini({ system, messages }) {
  const models = await geminiModelList();
  let lastErr;
  for (const model of models) {
    try {
      const out = await callOpenAICompatible({ system, messages, base: GEMINI_BASE, model });
      if (!process.env.AI_MODEL) geminiWorking = model;
      return { ...out, model };
    } catch (e) {
      lastErr = e;
      if (!modelUnusable(e)) throw e;   // z. B. echtes Rate-Limit → nicht weiterprobieren
      if (geminiWorking === model) geminiWorking = null;
    }
  }
  throw Object.assign(new Error(`Kein Gemini-Modell mit diesem Schlüssel nutzbar (probiert: ${models.join(", ")}). Letzter Fehler: ${lastErr?.message || "?"}`), { status: lastErr?.status || 502 });
}

const ACTIONS_DOC = `Du kannst die App steuern. Antworte IMMER als reines JSON-Objekt (kein Markdown drumherum):
{"reply": "<kurze Antwort auf Deutsch>", "actions": [ ... ]}
Mögliche actions (nur wenn passend, sonst leeres Array):
- {"type":"navigate","view":"dashboard|log|plans|history|library|stats|fortschritt|gesundheit|wochenplan|nutrition|goals|challenges|profile"}
- {"type":"start_workout","planId":<id aus context.plans>}   – startet das Training sofort
- {"type":"create_plan","plan":{"name":"…","color":"#FF6B35","types":["…"],"exercises":[{"name":"…","sets":3,"reps":"8-10","note":"…"}]}}   – Nutzer bestätigt vor dem Speichern
- {"type":"suggest_meal","meal":{"name":"…","kcal":0,"protein":0,"carbs":0,"fat":0,"ingredients":["…"],"steps":["…"]}}
Regeln: Nutze nur planIds aus dem Kontext. Erfinde keine Trainingsdaten – analysiere nur, was im Kontext steht.
Halte "reply" knapp (Sprachsteuerung auf dem Handy), ausführliche Analysen dürfen länger sein.`;

const TASK_HINTS = {
  plan: "Aufgabe: Erstelle einen passenden Trainingsplan als create_plan-Aktion.",
  meal: "Aufgabe: Schlage ein Gericht passend zu Ziel und heutigen Makros vor (suggest_meal).",
  analyze: "Aufgabe: Analysiere die genannten Trainingseinheiten: Fortschritt, Auffälligkeiten, konkrete Tipps.",
};

const systemPrompt = (task) =>
  `Du bist der Fitness-Coach und Sprachassistent in der App FitForge. Heute ist ${new Date().toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })}.\n${ACTIONS_DOC}\n${TASK_HINTS[task] || ""}`;

function parseModelJson(text) {
  const t = String(text || "").trim();
  const candidates = [t, t.replace(/^```(?:json)?\s*|\s*```$/g, ""), (t.match(/\{[\s\S]*\}/) || [""])[0]];
  for (const c of candidates) {
    try { const j = JSON.parse(c); if (j && typeof j === "object") return { reply: String(j.reply || ""), actions: Array.isArray(j.actions) ? j.actions : [] }; } catch {}
  }
  return { reply: t, actions: [] };
}

async function callAnthropic({ system, messages }) {
  const client = new Anthropic({ apiKey: process.env.AI_API_KEY });
  const model = process.env.AI_MODEL || "claude-opus-5";
  const params = {
    model,
    max_tokens: 16000,
    system,
    messages,
    output_config: { effort: process.env.AI_EFFORT || "medium" },
  };
  // Server-seitige Fallbacks bei Ablehnungen (Opus 5 / Fable 5.1)
  const useFallbacks = /^claude-(opus-5$|fable-5)/.test(model);
  const res = useFallbacks
    ? await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
    : await client.messages.create(params);
  if (res.stop_reason === "refusal") return { reply: "Dazu kann ich leider nichts sagen.", actions: [] };
  const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
  return parseModelJson(text);
}

async function callOpenAICompatible({ system, messages, base, model }) {
  base = (base || process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  model = model || process.env.AI_MODEL;
  const send = (jsonMode) => fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
    body: JSON.stringify({ model, messages: [{ role: "system", content: system }, ...messages], ...(jsonMode ? { response_format: { type: "json_object" } } : {}) }),
  });
  let r = await send(true);
  if (r.status === 400) r = await send(false); // manche Modelle kennen den JSON-Modus nicht
  const j = await r.json().catch(() => ({}));
  const body = Array.isArray(j) ? j[0] : j; // Gemini liefert Fehler teils als Array
  if (!r.ok) throw Object.assign(new Error(body?.error?.message || `HTTP ${r.status}`), { status: r.status });
  return parseModelJson(body?.choices?.[0]?.message?.content);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST erwartet" });
  if (!process.env.AI_API_KEY) return res.status(501).json({ error: "KI noch nicht eingerichtet" });

  try {
    const uid = await verifyUser((req.headers.authorization || "").replace(/^Bearer\s+/i, ""));
    if (!uid) return res.status(401).json({ error: "Nicht eingeloggt" });
  } catch { return res.status(401).json({ error: "Anmeldung konnte nicht geprüft werden" }); }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const history = (Array.isArray(body?.messages) ? body.messages : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-12);
  if (!history.length || history[history.length - 1].role !== "user") return res.status(400).json({ error: "Keine Nachricht" });
  // Kontext (Pläne, letzte Trainings, Ernährung …) als erste Nutzer-Nachricht voranstellen
  const ctx = JSON.stringify(body.context || {}).slice(0, 60000);
  const messages = [{ role: "user", content: `App-Kontext (JSON):\n${ctx}` }, { role: "assistant", content: '{"reply":"Kontext erhalten.","actions":[]}' }, ...history];

  try {
    const system = systemPrompt(body.task);
    const provider = providerName();
    const out = provider === "anthropic" ? await callAnthropic({ system, messages })
      : provider === "gemini" ? await callGemini({ system, messages })
      : await callOpenAICompatible({ system, messages });
    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Zu viele Anfragen – kurz warten" });
    if (e instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "KI-Schlüssel ungültig" });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: `KI-Fehler ${e.status}` });
    if (e.status === 429) return res.status(429).json({ error: "KI-Limit erreicht – kurz warten und nochmal versuchen" });
    if (e.status === 401 || e.status === 403) return res.status(500).json({ error: "KI-Schlüssel ungültig oder ohne Berechtigung", detail: String(e.message || "").slice(0, 400) });
    return res.status(502).json({ error: "KI nicht erreichbar: " + e.message });
  }
}

export const _test = { parseModelJson, providerName, pickGeminiModel, geminiCandidates, modelUnusable, verifyUser };
