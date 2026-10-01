// ─── KI-Client ───────────────────────────────────────────────────────────────
// Einfacher Aufruf von /api/ai für Module (Tagesform, Wochen-Story …).
// Liefert den Antworttext ("reply") oder wirft einen Fehler mit lesbarer Meldung.
const ffAskAI = async ({ task = "chat", prompt, context = {} }) => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new Error("Offline – die KI braucht Internet");
  const u = window.firebase?.auth?.().currentUser;
  if (!u) throw new Error("Nicht eingeloggt");
  const idt = await u.getIdToken();
  let preferModel = null; try { preferModel = localStorage.getItem("ff_ai_model"); } catch (e) {}
  const r = await fetch("/api/ai", {
    method: "POST",
    signal: AbortSignal.timeout ? AbortSignal.timeout(70000) : undefined,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + idt },
    body: JSON.stringify({ task, messages: [{ role: "user", content: prompt }], context, preferModel }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 501 || r.status === 404) throw new Error("KI ist noch nicht eingerichtet");
  if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
  try { if (j.model) localStorage.setItem("ff_ai_model", j.model); } catch (e) {}
  return j.reply || "";
};

// Kleiner Cache in localStorage (z. B. eine KI-Antwort pro Tag/Woche)
const ffCacheGet = (k) => { try { return JSON.parse(localStorage.getItem("ff_cache_" + k)); } catch (e) { return null; } };
const ffCacheSet = (k, v) => { try { localStorage.setItem("ff_cache_" + k, JSON.stringify(v)); } catch (e) {} };

// Markdown-light: **fett** und Zeilenumbrüche
const ffRichText = (txt) => String(txt || "").split("\n").map((line, i) => (
  <div key={i} style={{ minHeight: line.trim() ? 0 : 8 }}>
    {line.split(/(\*\*[^*]+\*\*)/g).map((p, j) => p.startsWith("**") && p.endsWith("**") ? <b key={j} style={{ color: "#F0EDE8" }}>{p.slice(2, -2)}</b> : p)}
  </div>
));

// Volumen eines Trainings (kg)
const ffWorkoutVolume = (w) => (w?.exercises || []).reduce((a, e) => a + (e.sets || []).reduce((b, x) => b + (parseFloat(x.weight) || 0) * (parseFloat(x.reps) || 0), 0), 0);
