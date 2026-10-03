// ─── Tägliches Befinden (Mini-Check-in) ──────────────────────────────────────
// user.wellbeing[YYYY-MM-DD] = { energy, mood, soreness, stress }  – jeweils 1–5
// Wird vom KI-Coach (context.alleDaten.befinden) und den Coach-Hinweisen genutzt.
const FF_WELLBEING = [
  ["energy", "Energie", ["😴", "🥱", "🙂", "💪", "⚡"]],
  ["mood", "Stimmung", ["😞", "😕", "😐", "🙂", "😄"]],
  ["soreness", "Muskelkater", ["✨", "🙂", "😬", "😣", "🥵"]],
  ["stress", "Stress", ["😌", "🙂", "😐", "😰", "🤯"]],
];

function WellbeingCheckin({ user, setUser, compact }) {
  const today = todayStr();
  const cur = user?.wellbeing?.[today] || {};
  const [editing, setEditing] = useState(false);
  const done = FF_WELLBEING.every(([k]) => cur[k]);
  const set = (k, v) => setUser(u => {
    const wb = { ...(u.wellbeing || {}) };
    wb[today] = { ...(wb[today] || {}), [k]: v, at: Date.now() };
    // nur die letzten 400 Tage behalten (Profil-Dokument klein halten)
    const keys = Object.keys(wb).sort(); keys.slice(0, Math.max(0, keys.length - 400)).forEach(d => delete wb[d]);
    return { ...u, wellbeing: wb, updatedAt: Date.now() };
  });
  if (done && !editing) return (
    <div onClick={() => setEditing(true)} style={{ display: "flex", alignItems: "center", gap: 10, padding: compact ? "10px 12px" : "12px 16px", borderRadius: 16, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", cursor: "pointer", marginBottom: compact ? 0 : 16 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: "#888" }}>Heute:</span>
      {FF_WELLBEING.map(([k, l, em]) => <span key={k} title={l} style={{ fontSize: 13, color: "#ccc" }}>{em[cur[k] - 1]} <span style={{ fontSize: 10, color: "#666" }}>{l}</span></span>)}
      <span style={{ marginLeft: "auto", fontSize: 11, color: "#555" }}>ändern</span>
    </div>
  );
  return (
    <div style={{ padding: compact ? 12 : 16, borderRadius: 18, background: "linear-gradient(135deg,rgba(167,139,250,0.10),rgba(76,201,240,0.05))", border: "1px solid rgba(167,139,250,0.25)", marginBottom: compact ? 0 : 16 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#F0EDE8", marginBottom: 2 }}>Wie geht's dir heute?</div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>10 Sekunden – dein Coach passt Tipps & Training daran an.</div>
      {FF_WELLBEING.map(([k, l, em]) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ width: 84, fontSize: 12, color: "#bbb", flexShrink: 0 }}>{l}</div>
          <div style={{ display: "flex", gap: 4, flex: 1 }}>
            {em.map((e, i) => (
              <button key={i} onClick={() => { set(k, i + 1); try { ffVibrate?.(8); } catch (x) {} }} aria-label={`${l} ${i + 1} von 5`}
                style={{ flex: 1, minWidth: 0, padding: "6px 0", fontSize: 18, borderRadius: 10, cursor: "pointer", border: cur[k] === i + 1 ? "1px solid #A78BFA" : "1px solid transparent", background: cur[k] === i + 1 ? "rgba(167,139,250,0.22)" : "rgba(255,255,255,0.04)", opacity: cur[k] && cur[k] !== i + 1 ? 0.45 : 1, transition: "all .15s" }}>{e}</button>
            ))}
          </div>
        </div>
      ))}
      {done && <button onClick={() => setEditing(false)} style={{ ...s.secBtn, width: "100%", justifyContent: "center", marginTop: 6, padding: "8px" }}>Fertig ✓</button>}
    </div>
  );
}
