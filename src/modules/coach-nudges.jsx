// ─── Proaktive Coach-Hinweise ────────────────────────────────────────────────
// Lokale Regeln (sofort, offline, ohne KI-Kosten) über alle Daten → max. 3 Hinweise auf dem Dashboard.
// Einmal am Tag zusätzlich als Benachrichtigung, wenn der Nutzer Mitteilungen erlaubt hat.
// "Mit Coach besprechen" öffnet den KI-Chat mit passender Frage.

function ffCoachNudges({ data, user, nutrition, health, library }) {
  const out = [];
  const today = todayStr();
  const ago = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const daysSince = d => Math.round((new Date(today) - new Date(d)) / 864e5);
  const ws = (data?.workouts || []).filter(w => w?.date).sort((a, b) => a.date.localeCompare(b.date));
  let an = null;
  try { an = buildTrainingAnalytics({ data, user, nutrition, health, library }); } catch (e) {}

  // 1) Trainingspause
  const lastW = ws[ws.length - 1];
  if (lastW && daysSince(lastW.date) >= 4) out.push({ prio: 3, icon: "⏰", color: "#FFD166", text: `Seit **${daysSince(lastW.date)} Tagen** kein Training.`, ask: `Ich habe seit ${daysSince(lastW.date)} Tagen nicht trainiert. Was ist heute das sinnvollste Training für mich?` });

  // 2) Vernachlässigte Muskelgruppe (früher regelmäßig, jetzt ≥ 9 Tage nicht)
  if (an?.uebungen?.length) {
    const byMuscle = {};
    an.uebungen.forEach(u => (u.muskeln || []).forEach(m => { const b = byMuscle[m] = byMuscle[m] || { last: 999, n: 0 }; b.last = Math.min(b.last, u.tageSeitLetztem); b.n += u.einheiten; }));
    const neglected = Object.entries(byMuscle).filter(([, b]) => b.n >= 3 && b.last >= 9 && b.last < 60).sort((a, b) => b[1].last - a[1].last)[0];
    if (neglected) out.push({ prio: 2, icon: "🦵", color: "#4CC9F0", text: `**${neglected[0]}** seit **${neglected[1].last} Tagen** nicht trainiert.`, ask: `Ich habe ${neglected[0]} seit ${neglected[1].last} Tagen nicht trainiert. Wie baue ich das diese Woche sinnvoll ein?` });
    // 3) Stagnation bei einer Hauptübung
    const stuck = an.uebungen.find(u => u.einheiten >= 5 && (u.letzteEinheiten || []).filter(p => p.e1rm).length >= 4 && (() => { const v = u.letzteEinheiten.filter(p => p.e1rm).map(p => p.e1rm); return Math.max(...v.slice(-3)) <= v[0]; })() && u.tageSeitLetztem < 21);
    if (stuck) out.push({ prio: 2, icon: "📉", color: "#EF476F", text: `**${stuck.name}** stagniert seit den letzten Einheiten.`, ask: `Mein ${stuck.name} stagniert. Woran liegt das laut meinen Daten und wie komme ich wieder voran?` });
    // 4) Positiv: neuer Bestwert in den letzten 3 Tagen
    const pr = an.uebungen.find(u => u.e1rmBestDatum && u.e1rmBestDatum >= ago(3) && u.einheiten >= 3 && u.e1rmBest > u.e1rmStart);
    if (pr) out.push({ prio: 1, icon: "🏆", color: "#06D6A0", text: `Neuer Bestwert bei **${pr.name}**: **${pr.e1rmBest} kg** e1RM!`, ask: `Ich habe bei ${pr.name} einen neuen Bestwert. Wie baue ich darauf am besten auf?` });
  }

  // 5) Protein unter Ziel (vollständig geloggte Tage der letzten 7)
  const goalP = parseFloat(user?.proteinGoal) || 0, goalK = parseFloat(user?.calorieGoal) || 2500;
  const nd = Object.entries(nutrition || {}).filter(([d, v]) => d >= ago(7) && d < today && (v?.meals || []).length >= 3 && (+v.calories || 0) >= goalK * 0.5);
  if (goalP && nd.length >= 3) {
    const p = Math.round(nd.reduce((a, [, v]) => a + (+v.protein || 0), 0) / nd.length);
    if (p < goalP * 0.85) out.push({ prio: 2, icon: "🥩", color: "#00D9C0", text: `Protein im Schnitt **${p} g** statt **${goalP} g**.`, ask: `Ich komme im Schnitt nur auf ${p} g Protein statt ${goalP} g. Gib mir konkrete, einfache Ideen aus meinen üblichen Lebensmitteln.` });
  }
  // 6) Kaum Essen geloggt
  const loggedDays = Object.entries(nutrition || {}).filter(([d, v]) => d >= ago(7) && d < today && (v?.meals || []).length).length;
  if (ws.length && loggedDays <= 2 && Object.keys(nutrition || {}).length) out.push({ prio: 1, icon: "📝", color: "#A78BFA", text: `Nur **${loggedDays} von 7 Tagen** Essen geloggt – für gute Auswertungen mehr loggen.`, ask: null, view: "nutrition" });

  // 7) Schlaf
  const sl = Object.values(health?.sleep || {}).filter(x => x?.date >= ago(7));
  if (sl.length >= 3) {
    const avg = sl.reduce((a, x) => a + (x.asleepMin || 0), 0) / sl.length;
    if (avg < 390) out.push({ prio: 3, icon: "😴", color: "#4361EE", text: `Nur **${Math.floor(avg / 60)}h ${String(Math.round(avg % 60)).padStart(2, "0")}m** Schlaf im Schnitt (7 Tage).`, ask: "Ich schlafe zu wenig. Wie wirkt sich das laut meinen Daten auf mein Training aus und was kann ich konkret ändern?" });
  }
  // 8) Ruhepuls deutlich erhöht
  const dl = Object.values(health?.daily || {}).filter(x => x?.restingHR).sort((a, b) => a.date.localeCompare(b.date));
  if (dl.length >= 10) {
    const last = dl[dl.length - 1], base = dl.slice(-31, -1).reduce((a, x) => a + x.restingHR, 0) / Math.min(30, dl.length - 1);
    if (last.date >= ago(1) && last.restingHR >= base + 6) out.push({ prio: 3, icon: "❤️", color: "#EF476F", text: `Ruhepuls **${last.restingHR}** – **${Math.round(last.restingHR - base)} über** deinem Schnitt. Heute eher locker.`, ask: "Mein Ruhepuls ist heute deutlich erhöht. Soll ich trotzdem trainieren und wenn ja wie?" });
  }
  // 9) Befinden
  const wb = user?.wellbeing?.[today];
  if (wb && (wb.soreness >= 4 || wb.energy <= 2)) out.push({ prio: 3, icon: "🔋", color: "#FFD166", text: wb.soreness >= 4 ? "Starker Muskelkater gemeldet – Fokus heute auf andere Muskeln oder Erholung." : "Wenig Energie heute – kürzeres, leichteres Training ist okay.", ask: `Mir geht's heute so: Energie ${wb.energy || "?"}/5, Muskelkater ${wb.soreness || "?"}/5, Stress ${wb.stress || "?"}/5. Was soll ich heute machen?` });
  // 10) Gewichtstrend passt nicht zum Ziel
  const wh = (data?.weightHistory || []).filter(h => h?.date >= ago(21)).sort((a, b) => a.date.localeCompare(b.date));
  if (wh.length >= 3) {
    const d = Math.round((wh[wh.length - 1].value - wh[0].value) * 10) / 10;
    if (/verlust/i.test(user?.goal || "") && d >= 0.5) out.push({ prio: 2, icon: "⚖️", color: "#FF6B35", text: `Ziel Abnehmen, aber **+${d} kg** in 3 Wochen.`, ask: `Mein Ziel ist Gewichtsverlust, aber ich habe in 3 Wochen ${d} kg zugenommen. Was sagen meine Ernährungsdaten dazu?` });
    if (/aufbau/i.test(user?.goal || "") && d <= -1) out.push({ prio: 2, icon: "⚖️", color: "#FF6B35", text: `Ziel Muskelaufbau, aber **${d} kg** in 3 Wochen.`, ask: `Mein Ziel ist Muskelaufbau, aber ich habe in 3 Wochen ${Math.abs(d)} kg abgenommen. Esse ich zu wenig?` });
  }
  return out.sort((a, b) => b.prio - a.prio).slice(0, 3);
}

function CoachNudgesCard({ data, user, nutrition, health, library, onView }) {
  const today = todayStr();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem("ff_nudges_hidden") === today; } catch (e) { return false; } });
  const nudges = React.useMemo(() => ffCoachNudges({ data, user, nutrition, health, library }), [data, user, nutrition, health, library]);
  // Einmal pro Tag als Mitteilung (nur wenn bereits erlaubt – kein ungefragter Dialog)
  useEffect(() => {
    if (!nudges.length || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      if (localStorage.getItem("ff_nudge_notified") === today) return;
      localStorage.setItem("ff_nudge_notified", today);
      const body = nudges[0].text.replace(/\*\*/g, "");
      navigator.serviceWorker?.ready.then(r => r.showNotification("FitForge Coach", { body, icon: "/icon-192.png", tag: "ff-coach" })).catch(() => { new Notification("FitForge Coach", { body }); });
    } catch (e) {}
  }, [nudges.length]);
  if (!nudges.length || hidden) return null;
  return (
    <div style={{ padding: 14, borderRadius: 18, background: "linear-gradient(135deg,rgba(255,107,53,0.08),rgba(167,139,250,0.06))", border: "1px solid rgba(255,140,96,0.22)", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#FF8C60" }}>✨ Dein Coach hat bemerkt</div>
        <button onClick={() => { setHidden(true); try { localStorage.setItem("ff_nudges_hidden", today); } catch (e) {} }} aria-label="Für heute ausblenden" style={{ all: "unset", cursor: "pointer", color: "#666", fontSize: 12 }}>heute ausblenden ✕</button>
      </div>
      {nudges.map((n, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
          <span style={{ fontSize: 20, flexShrink: 0 }}>{n.icon}</span>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: "#ddd", lineHeight: 1.4 }}>{ffRichText(n.text)}</div>
          {n.ask ? <button onClick={() => window.ffOpenAI?.({ autoSend: true, task: "chat", prompt: n.ask })} style={{ ...s.secBtn, flexShrink: 0, padding: "6px 10px", fontSize: 11, borderColor: n.color + "66", color: n.color }}>💬 Coach</button>
            : n.view ? <button onClick={() => onView?.(n.view)} style={{ ...s.secBtn, flexShrink: 0, padding: "6px 10px", fontSize: 11 }}>Öffnen</button> : null}
        </div>
      ))}
    </div>
  );
}
