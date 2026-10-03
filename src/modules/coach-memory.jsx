// ─── Coach-Gedächtnis ────────────────────────────────────────────────────────
// user.coachMemory = [{ id, text, date }] – dauerhafte Fakten (Verletzungen, Vorlieben, Ziele, Zeitplan).
// Die KI legt Einträge über {"type":"remember","fact":"…"} an und löscht sie mit {"type":"forget","fact":"…"}.
const FF_MEMORY_MAX = 60;

const ffMemoryApply = (list, a) => {
  const cur = Array.isArray(list) ? list : [];
  const fact = String(a.fact || a.text || "").trim().slice(0, 240);
  if (!fact) return cur;
  const low = fact.toLowerCase();
  if (a.type === "forget") return cur.filter(m => !m.text.toLowerCase().includes(low) && !low.includes(m.text.toLowerCase()));
  if (cur.some(m => m.text.toLowerCase() === low)) return cur;
  return [...cur, { id: Date.now() + Math.random(), text: fact, date: todayStr() }].slice(-FF_MEMORY_MAX);
};

function CoachMemoryPanel({ memory, onDelete, onAdd }) {
  const [txt, setTxt] = useState("");
  const list = memory || [];
  return (
    <div style={{ padding: 12, borderRadius: 14, background: "rgba(76,201,240,0.06)", border: "1px solid rgba(76,201,240,0.2)" }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: "#4CC9F0", marginBottom: 4 }}>🧠 Das weiß dein Coach über dich</div>
      <div style={{ fontSize: 11, color: "#777", marginBottom: 8 }}>Erzähl im Chat z. B. von Verletzungen, Vorlieben oder deinem Zeitplan – der Coach merkt es sich. Du kannst hier alles löschen.</div>
      {!list.length && <div style={{ fontSize: 12, color: "#555", fontStyle: "italic", marginBottom: 8 }}>Noch nichts gespeichert.</div>}
      {list.map(m => (
        <div key={m.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0", borderTop: "1px solid rgba(255,255,255,0.05)", fontSize: 13, color: "#ddd" }}>
          <span style={{ flex: 1, minWidth: 0 }}>{m.text}<span style={{ fontSize: 10, color: "#555", marginLeft: 6 }}>{m.date}</span></span>
          <button onClick={() => onDelete(m.id)} aria-label="Vergessen" style={{ all: "unset", cursor: "pointer", color: "#777", fontSize: 13, padding: "0 4px" }}>✕</button>
        </div>
      ))}
      <form onSubmit={e => { e.preventDefault(); if (txt.trim()) { onAdd(txt.trim()); setTxt(""); } }} style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input value={txt} onChange={e => setTxt(e.target.value)} placeholder="z. B. Knie links empfindlich" style={{ ...s.inp, flex: 1, margin: 0, fontSize: 14, padding: "8px 10px" }} />
        <button type="submit" disabled={!txt.trim()} style={{ ...s.secBtn, padding: "8px 12px", opacity: txt.trim() ? 1 : 0.5 }}>＋</button>
      </form>
    </div>
  );
}
