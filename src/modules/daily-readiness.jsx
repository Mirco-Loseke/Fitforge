// ─── Tagesform-Coach ─────────────────────────────────────────────────────────
// Berechnet aus Apple-Health-Daten (Schlaf, HRV, Ruhepuls) und der Trainingslast
// der letzten Tage einen Erholungs-Score 0–100. Auf Wunsch macht die KI daraus
// einen konkreten Plan für heute (einmal pro Tag gecacht).

const ffReadiness = (health, workouts) => {
  const sleep = Object.values(health?.sleep || {}).sort((a, b) => a.date.localeCompare(b.date));
  const daily = Object.values(health?.daily || {}).sort((a, b) => a.date.localeCompare(b.date));
  const today = todayStr();
  const yest = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const avg = (arr, k) => { const v = arr.map(x => x[k]).filter(x => x != null && x > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

  const lastSleep = [...sleep].reverse().find(x => x.date === today || x.date === yest) || null;
  const lastDaily = [...daily].reverse().find(x => (x.date === today || x.date === yest) && (x.hrv || x.restingHR)) || null;
  const base = daily.slice(-15, -1);
  const baseHrv = avg(base, "hrv"), baseRhr = avg(base, "restingHR");

  let score = 70; const factors = [];
  if (lastSleep?.asleepMin) {
    const h = lastSleep.asleepMin / 60;
    const d = Math.max(-20, Math.min(12, (h - 7.5) * 8));
    score += d;
    factors.push({ k: "Schlaf", v: `${Math.floor(h)}h ${String(Math.round(lastSleep.asleepMin % 60)).padStart(2, "0")}`, good: h >= 7, icon: "😴" });
  }
  if (lastDaily?.hrv && baseHrv) {
    const r = lastDaily.hrv / baseHrv;
    score += Math.max(-15, Math.min(12, (r - 1) * 60));
    factors.push({ k: "HRV", v: `${Math.round(lastDaily.hrv)} ms`, good: r >= 0.95, icon: "💓", trend: r >= 1.03 ? "↑" : r <= 0.95 ? "↓" : "→" });
  }
  if (lastDaily?.restingHR && baseRhr) {
    const diff = lastDaily.restingHR - baseRhr;
    score -= Math.max(-6, Math.min(12, diff * 2.5));
    factors.push({ k: "Ruhepuls", v: `${Math.round(lastDaily.restingHR)} bpm`, good: diff <= 2, icon: "❤️", trend: diff >= 3 ? "↑" : diff <= -2 ? "↓" : "→" });
  }
  // Trainingslast: harte Tage hintereinander kosten Erholung, Pausen geben welche zurück
  const ws = (workouts || []).filter(w => w.date);
  const daysAgo = (d) => Math.round((new Date(today) - new Date(d)) / 86400000);
  const recent = ws.filter(w => daysAgo(w.date) >= 0 && daysAgo(w.date) <= 2);
  const lastW = ws.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  const rest = lastW ? daysAgo(lastW.date) : null;
  score -= recent.length * 5;
  if (rest != null && rest >= 2) score += Math.min(8, rest * 3);
  factors.push({ k: "Pause", v: rest == null ? "–" : rest === 0 ? "heute trainiert" : `${rest} ${rest === 1 ? "Tag" : "Tage"}`, good: rest == null || rest >= 1, icon: "🗓️" });

  const hasHealth = !!(lastSleep || lastDaily);
  score = Math.round(Math.max(5, Math.min(100, score)));
  const level = score >= 75 ? { t: "Bereit für Vollgas", c: "#06D6A0", tip: "Perfekter Tag für schwere Sätze oder einen neuen PR." }
    : score >= 55 ? { t: "Normal trainieren", c: "#FFD166", tip: "Plan wie gewohnt – aber keine Rekordjagd erzwingen." }
    : { t: "Erholung priorisieren", c: "#EF476F", tip: "Leichtes Training, Mobility oder Spaziergang statt Vollgas." };
  return { score, level, factors, hasHealth, lastWorkout: lastW, restDays: rest };
};

function ReadinessCard({ health, data, user, prs, isMobile }) {
  const r = ffReadiness(health, data?.workouts);
  const key = "readiness_" + todayStr();
  const [ai, setAi] = useState(() => ffCacheGet(key));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(!!ai);

  const askCoach = async () => {
    setBusy(true); setErr(null); setOpen(true);
    try {
      const last = (data?.workouts || []).slice(0, 6).map(w => ({ datum: w.date, name: w.name, dauerMin: w.duration,
        uebungen: (w.exercises || []).map(e => ({ name: e.name, saetze: (e.sets || []).map(s => `${s.weight || 0}kg×${s.reps || 0}`).join(", ") })) }));
      const reply = await ffAskAI({
        task: "readiness",
        prompt: "Wie sollte ich heute trainieren?",
        context: { tagesform: { score: r.score, einstufung: r.level.t, faktoren: r.factors.map(f => `${f.k}: ${f.v}${f.trend ? " " + f.trend : ""}`), pauseTage: r.restDays },
          letzteTrainings: last, plaene: (data?.plans || []).map(p => ({ name: p.name, uebungen: (p.exercises || []).map(e => e.name) })),
          rekorde: prs, ziel: user?.goal, wochentag: new Date().toLocaleDateString("de-DE", { weekday: "long" }) },
      });
      setAi(reply); ffCacheSet(key, reply);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  const R = 34, C = 2 * Math.PI * R;
  return (
    <div className="chalCardIn" style={{ marginTop: 18, position: "relative", overflow: "hidden", borderRadius: 20, padding: isMobile ? 16 : 20,
      background: `linear-gradient(150deg, ${r.level.c}1A 0%, rgba(22,22,28,0.6) 55%)`, border: `1px solid ${r.level.c}40`, boxShadow: "inset 0 1px 1px rgba(255,255,255,0.06), 0 10px 30px rgba(0,0,0,0.35)" }}>
      <div style={{ position: "absolute", top: -50, right: -30, width: 160, height: 160, borderRadius: "50%", background: r.level.c, opacity: 0.12, filter: "blur(40px)", pointerEvents: "none" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ position: "relative", width: 84, height: 84, flexShrink: 0 }}>
          <svg width="84" height="84" viewBox="0 0 84 84">
            <circle cx="42" cy="42" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
            <circle className="ringIn" cx="42" cy="42" r={R} fill="none" stroke={r.level.c} strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - r.score / 100)} transform="rotate(-90 42 42)" style={{ filter: `drop-shadow(0 0 6px ${r.level.c}90)`, transition: "stroke-dashoffset 1s ease" }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{r.score}</div>
            <div style={{ fontSize: 8, fontWeight: 800, color: "#888", letterSpacing: 1 }}>TAGESFORM</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 900, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>Tagesform-Coach</div>
          <div style={{ fontSize: 19, fontWeight: 900, color: r.level.c, margin: "2px 0 4px" }}>{r.level.t}</div>
          <div style={{ fontSize: 12.5, color: "#aaa", lineHeight: 1.4 }}>{r.level.tip}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
        {r.factors.map(f => (
          <div key={f.k} style={{ flex: "1 1 70px", padding: "8px 8px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: `1px solid ${f.good ? "rgba(255,255,255,0.08)" : "rgba(239,71,111,0.3)"}` }}>
            <div style={{ fontSize: 9.5, color: "#777", fontWeight: 800, textTransform: "uppercase" }}>{f.icon} {f.k}</div>
            <div style={{ fontSize: 13.5, fontWeight: 900, color: f.good ? "#F0EDE8" : "#EF476F", marginTop: 2 }}>{f.v} {f.trend || ""}</div>
          </div>
        ))}
      </div>
      {!r.hasHealth && <div style={{ fontSize: 11.5, color: "#777", marginTop: 10 }}>⌚ Mit Apple-Watch-Daten (Schlaf, HRV, Ruhepuls) wird der Score viel genauer – einrichten unter „Schlaf & Gesundheit".</div>}
      {open && (
        <div style={{ marginTop: 14, padding: 14, borderRadius: 14, background: "rgba(0,0,0,0.25)", border: "1px solid rgba(167,139,250,0.25)", fontSize: 13, color: "#ccc", lineHeight: 1.55 }}>
          {busy ? <div style={{ color: "#A78BFA" }}>✨ Coach analysiert deine Tagesform…</div> : err ? <div style={{ color: "#EF476F" }}>⚠️ {err}</div> : ffRichText(ai)}
        </div>
      )}
      <button onClick={ai && !open ? () => setOpen(true) : askCoach} disabled={busy} style={{ marginTop: 12, width: "100%", height: 46, borderRadius: 14, border: "1px solid rgba(167,139,250,0.4)", background: "rgba(167,139,250,0.12)", color: "#C4B5FD", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}>
        {busy ? "Analysiere…" : ai ? (open ? "↻ Neu einschätzen" : "✨ Plan für heute anzeigen") : "✨ KI-Plan für heute"}
      </button>
    </div>
  );
}
