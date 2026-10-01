// ─── Wochen-Story ────────────────────────────────────────────────────────────
// Instagram-Story-artiger Rückblick auf die letzten 7 Tage (vs. Vorwoche):
// Tippen = weiter, KI-Fazit pro Woche gecacht, Bild zum Teilen.

const ffWeekStats = (workouts, prs) => {
  const day = 86400000, now = Date.now();
  const inRange = (w, from, to) => { const t = new Date(w.date + "T12:00:00").getTime(); return t > now - to * day && t <= now - from * day; };
  const cur = (workouts || []).filter(w => w.date && inRange(w, 0, 7));
  const prev = (workouts || []).filter(w => w.date && inRange(w, 7, 14));
  const sum = (arr, f) => arr.reduce((a, w) => a + f(w), 0);
  const vol = sum(cur, ffWorkoutVolume), prevVol = sum(prev, ffWorkoutVolume);
  const mins = sum(cur, w => parseInt(w.duration) || 0), prevMins = sum(prev, w => parseInt(w.duration) || 0);
  const sets = sum(cur, w => (w.exercises || []).reduce((a, e) => a + (e.sets || []).length, 0));
  const km = sum(cur, w => (w.exercises || []).reduce((a, e) => a + (e.sets || []).reduce((b, x) => b + (parseFloat(x.km) || 0), 0), 0));
  // Top-Übung: höchstes Satz-Gewicht der Woche
  let top = null;
  cur.forEach(w => (w.exercises || []).forEach(e => (e.sets || []).forEach(x => {
    const kg = parseFloat(x.weight) || 0;
    if (kg > 0 && (!top || kg > top.kg)) top = { name: e.name, kg, reps: x.reps };
  })));
  const pct = (a, b) => b > 0 ? Math.round((a - b) / b * 100) : null;
  return { count: cur.length, prevCount: prev.length, vol, prevVol, volPct: pct(vol, prevVol), mins, minsPct: pct(mins, prevMins), sets, km: Math.round(km * 10) / 10, top,
    days: [...new Set(cur.map(w => w.date))].length, weekKey: (() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })() };
};

const ffFmtVol = v => v >= 1000 ? `${(v / 1000).toFixed(1)} t` : `${Math.round(v)} kg`;

function WeeklyStoryCard({ data, prs, user, isMobile }) {
  const st = ffWeekStats(data?.workouts, prs);
  const [open, setOpen] = useState(false);
  if (!st.count && !st.prevCount) return null;
  return (<>
    <div className="chalCardIn" onClick={() => setOpen(true)} style={{ marginTop: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", borderRadius: 18,
      background: "linear-gradient(120deg, rgba(255,107,53,0.16), rgba(167,139,250,0.12))", border: "1px solid rgba(255,107,53,0.3)" }}>
      <div style={{ width: 52, height: 52, borderRadius: "50%", padding: 2.5, background: "conic-gradient(#FF6B35, #A78BFA, #06D6A0, #FF6B35)", flexShrink: 0 }}>
        <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "#141418", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>📊</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: "#F0EDE8" }}>Deine Woche als Story</div>
        <div style={{ fontSize: 12, color: "#999" }}>{st.count} Trainings · {ffFmtVol(st.vol)}{st.volPct != null ? ` · ${st.volPct >= 0 ? "+" : ""}${st.volPct} %` : ""}</div>
      </div>
      <div style={{ color: "#FF6B35", fontSize: 20 }}>▶</div>
    </div>
    {open && <WeeklyStory st={st} data={data} user={user} onClose={() => setOpen(false)} />}
  </>);
}

function WeeklyStory({ st, data, user, onClose }) {
  const key = "story_" + st.weekKey;
  const [ai, setAi] = useState(() => ffCacheGet(key));
  const [aiErr, setAiErr] = useState(null);
  const [i, setI] = useState(0);
  const [t0, setT0] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const DUR = 5000;
  const up = (p) => p == null ? null : <span style={{ color: p >= 0 ? "#06D6A0" : "#EF476F" }}>{p >= 0 ? "▲ +" : "▼ "}{p} % vs. Vorwoche</span>;
  const slides = [
    { bg: "#FF6B35", emoji: "🔥", big: String(st.count), label: st.count === 1 ? "Training diese Woche" : "Trainings diese Woche", sub: <>an {st.days} {st.days === 1 ? "Tag" : "Tagen"} · {Math.floor(st.mins / 60)}h {st.mins % 60}min{st.minsPct != null ? <><br />{up(st.minsPct)}</> : null}</> },
    { bg: "#4CC9F0", emoji: "🏋️", big: ffFmtVol(st.vol), label: "bewegtes Gewicht", sub: <>{st.sets} Sätze{st.km ? ` · ${st.km} km gelaufen` : ""}<br />{up(st.volPct)}</> },
    ...(st.top ? [{ bg: "#A78BFA", emoji: "🏆", big: `${st.top.kg} kg`, label: st.top.name, sub: <>Schwerster Satz der Woche{st.top.reps ? ` · ${st.top.reps} Wdh.` : ""}</> }] : []),
    { bg: "#06D6A0", emoji: "✨", ai: true },
  ];
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 80); return () => clearInterval(t); }, []);
  useEffect(() => { if (now - t0 > DUR && !slides[i].ai) next(); }, [now]);
  useEffect(() => {
    if (ai || !slides[i]?.ai) return;
    ffAskAI({ task: "story", prompt: "Fasse meine Trainingswoche zusammen.", context: { woche: { ...st, top: st.top }, ziel: user?.goal, name: user?.name } })
      .then(r => { setAi(r); ffCacheSet(key, r); }).catch(e => setAiErr(e.message));
  }, [i]);
  const next = () => { if (i < slides.length - 1) { setI(i + 1); setT0(Date.now()); } else onClose(); };
  const prev = () => { if (i > 0) { setI(i - 1); setT0(Date.now()); } };
  const sl = slides[i];

  const share = async () => {
    const c = document.createElement("canvas"); c.width = 1080; c.height = 1920; const g = c.getContext("2d");
    const bg = g.createLinearGradient(0, 0, 1080, 1920); bg.addColorStop(0, "#22140F"); bg.addColorStop(0.5, "#141418"); bg.addColorStop(1, "#16122A"); g.fillStyle = bg; g.fillRect(0, 0, 1080, 1920);
    g.textAlign = "center"; g.fillStyle = "#FF6B35"; g.font = "900 56px 'DM Sans',sans-serif"; g.fillText("FITFORGE · MEINE WOCHE", 540, 200);
    const rows = [[String(st.count), "TRAININGS", "#FF6B35"], [ffFmtVol(st.vol), "VOLUMEN" + (st.volPct != null ? `  (${st.volPct >= 0 ? "+" : ""}${st.volPct} %)` : ""), "#4CC9F0"],
      [`${Math.floor(st.mins / 60)}h ${st.mins % 60}m`, "TRAININGSZEIT", "#06D6A0"], ...(st.top ? [[`${st.top.kg} kg`, st.top.name.toUpperCase().slice(0, 28), "#A78BFA"]] : [])];
    rows.forEach(([v, l, col], k) => {
      const y = 420 + k * 330;
      g.fillStyle = col; g.font = "900 150px 'DM Sans',sans-serif"; g.fillText(v, 540, y + 150);
      g.fillStyle = "#999"; g.font = "800 40px 'DM Sans',sans-serif"; g.fillText(l, 540, y + 220);
    });
    const blob = await new Promise(r => c.toBlob(r, "image/png"));
    const file = new File([blob], "fitforge-woche.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: "Meine FitForge-Woche" }); } catch (e) {} }
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "fitforge-woche.png"; a.click(); }
  };

  return (<ToBody>
    <div style={{ position: "fixed", inset: 0, zIndex: 100001, background: `radial-gradient(circle at 50% 30%, ${sl.bg}40, #0B0B0E 70%)`, transition: "background .5s", display: "flex", flexDirection: "column", padding: "calc(12px + env(safe-area-inset-top)) 16px calc(20px + env(safe-area-inset-bottom))" }}>
      <div style={{ display: "flex", gap: 4 }}>
        {slides.map((_, k) => (
          <div key={k} style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.2)", overflow: "hidden" }}>
            <div style={{ height: "100%", background: "#fff", width: k < i ? "100%" : k > i ? "0%" : slides[k].ai ? "100%" : `${Math.min(100, (now - t0) / DUR * 100)}%` }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
        <div style={{ color: "#fff", fontWeight: 900, fontSize: 15 }}>Deine Woche</div>
        <button onClick={onClose} aria-label="Schließen" style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.1)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>{IC.x}</button>
      </div>
      <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <div onClick={prev} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "30%" }} />
        <div onClick={next} style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "70%" }} />
        <div key={i} className="fadeIn" style={{ pointerEvents: "none", maxWidth: 420, padding: "0 10px" }}>
          <div style={{ fontSize: 64, marginBottom: 10 }}>{sl.emoji}</div>
          {sl.ai ? (<>
            <div style={{ fontSize: 13, fontWeight: 900, color: "#06D6A0", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 12 }}>Coach-Fazit</div>
            <div style={{ fontSize: 16, color: "#ddd", lineHeight: 1.6, textAlign: "left" }}>{ai ? ffRichText(ai) : aiErr ? `⚠️ ${aiErr}` : "✨ Coach schreibt…"}</div>
          </>) : (<>
            <div style={{ fontSize: 64, fontWeight: 900, color: sl.bg, lineHeight: 1, textShadow: `0 0 40px ${sl.bg}80` }}>{sl.big}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", marginTop: 10 }}>{sl.label}</div>
            <div style={{ fontSize: 14, color: "#aaa", marginTop: 10, lineHeight: 1.6 }}>{sl.sub}</div>
          </>)}
        </div>
      </div>
      <button className="wkBtn wkBtn-next" style={{ width: "100%" }} onClick={share}>📸 Als Story teilen</button>
    </div>
  </ToBody>);
}
