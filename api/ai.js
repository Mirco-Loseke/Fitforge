// KI-Assistent: anbieter-unabhängiger Proxy. Der API-Schlüssel bleibt auf dem Server.
//
// Einrichtung (Vercel → Settings → Environment Variables):
//   AI_PROVIDER   "anthropic" (Standard) | "openai-compatible"
//   AI_API_KEY    API-Schlüssel des Anbieters
//   AI_MODEL      optional; Standard bei anthropic: claude-opus-5
//   AI_BASE_URL   nur openai-compatible, z. B. https://api.openai.com/v1,
//                 https://generativelanguage.googleapis.com/v1beta/openai, https://openrouter.ai/api/v1
//   AI_EFFORT     optional (anthropic): low | medium | high – Standard medium (schnelle Antworten)
// Ohne AI_API_KEY antwortet der Endpunkt mit 501 → die App nutzt dann ihre lokale Befehlserkennung.
//
// POST /api/ai  Authorization: Bearer <Firebase-ID-Token>
// Body: { messages:[{role:"user"|"assistant", content}], context:{...}, task?: "chat"|"plan"|"meal"|"analyze" }
// Antwort: { reply: string, actions: [ {type, ...} ] }
import Anthropic from "@anthropic-ai/sdk";
import { getAdmin, cors } from "./_lib.js";

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

async function callOpenAICompatible({ system, messages }) {
  const base = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_API_KEY}` },
    body: JSON.stringify({ model: process.env.AI_MODEL, messages: [{ role: "system", content: system }, ...messages], response_format: { type: "json_object" } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return parseModelJson(j?.choices?.[0]?.message?.content);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST erwartet" });
  if (!process.env.AI_API_KEY) return res.status(501).json({ error: "KI noch nicht eingerichtet" });

  try {
    const idToken = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    await getAdmin().auth().verifyIdToken(idToken);
  } catch { return res.status(401).json({ error: "Nicht eingeloggt" }); }

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
    const provider = (process.env.AI_PROVIDER || "anthropic").toLowerCase();
    const out = provider === "anthropic" ? await callAnthropic({ system, messages }) : await callOpenAICompatible({ system, messages });
    return res.status(200).json(out);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return res.status(429).json({ error: "Zu viele Anfragen – kurz warten" });
    if (e instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: "KI-Schlüssel ungültig" });
    if (e instanceof Anthropic.APIError) return res.status(502).json({ error: `KI-Fehler ${e.status}` });
    return res.status(502).json({ error: "KI nicht erreichbar: " + e.message });
  }
}

export const _test = { parseModelJson };
