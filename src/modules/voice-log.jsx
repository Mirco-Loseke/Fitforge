// ─── Sprach-Logging im Training ──────────────────────────────────────────────
// „80 Kilo 8 Wiederholungen fertig" → Gewicht/Wdh. in den nächsten offenen Satz,
// Satz abhaken. Außerdem: „nächste Übung", „Satz fertig".

const FF_NUM_WORDS = { null: 0, eins: 1, ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwölf: 12,
  dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19, zwanzig: 20, dreißig: 30, vierzig: 40, fünfzig: 50, hundert: 100 };

const ffParseSetSpeech = (raw) => {
  let t = " " + String(raw || "").toLowerCase().replace(/,/g, ".") + " ";
  Object.entries(FF_NUM_WORDS).forEach(([w, n]) => { t = t.replace(new RegExp(`\\b${w}\\b`, "g"), String(n)); });
  t = t.replace(/(\d+)\s*(komma|punkt)\s*(\d+)/g, "$1.$3").replace(/(\d+)\s*einhalb/g, (m, a) => String(+a + 0.5));
  const out = {};
  const w = t.match(/(\d+(?:\.\d+)?)\s*(kilo|kg|kilogramm)/);
  const r = t.match(/(\d+)\s*(wiederholung|wdh|mal\b|reps?\b|stück)/);
  if (w) out.weight = w[1];
  if (r) out.reps = r[1];
  if (!w && !r) {
    const nums = t.match(/\d+(?:\.\d+)?/g) || [];
    if (nums.length >= 2) { out.weight = nums[0]; out.reps = nums[1]; }
    else if (nums.length === 1 && /bei|mit/.test(t)) out.weight = nums[0];
  }
  if (/fertig|erledigt|geschafft|done|abhaken|check/.test(t)) out.done = true;
  if (/nächste übung|weiter|nächste\b/.test(t) && !out.weight && !out.reps) out.next = true;
  return out;
};

const ffSpeechRec = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;

function VoiceSetButton({ onResult, notify }) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const recRef = useRef(null);
  const SR = ffSpeechRec();
  if (!SR) return null;
  const toggle = () => {
    if (listening) { try { recRef.current?.stop(); } catch (e) {} return; }
    const rec = new SR();
    rec.lang = "de-DE"; rec.interimResults = true; rec.continuous = false;
    let finalText = "";
    rec.onresult = (e) => { let txt = ""; for (const r of e.results) { txt += r[0].transcript; if (r.isFinal) finalText = txt; } setHeard(txt); };
    rec.onend = () => {
      setListening(false);
      const txt = finalText.trim();
      if (!txt) return;
      const p = ffParseSetSpeech(txt);
      if (!p.weight && !p.reps && !p.done && !p.next) { notify?.(`Nicht verstanden: „${txt}"`, "error"); return; }
      onResult(p, txt);
      setTimeout(() => setHeard(""), 2500);
    };
    rec.onerror = (e) => { setListening(false); if (e.error !== "aborted" && e.error !== "no-speech") notify?.("Spracheingabe: " + e.error, "error"); };
    recRef.current = rec; setHeard(""); setListening(true); ffVibrate(10);
    try { rec.start(); } catch (e) { setListening(false); }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <button onClick={toggle} aria-label="Satz per Sprache eintragen" style={{ width: 46, height: 46, borderRadius: "50%", flexShrink: 0, border: `1px solid ${listening ? "#EF476F" : "rgba(167,139,250,0.4)"}`,
        background: listening ? "rgba(239,71,111,0.18)" : "rgba(167,139,250,0.12)", color: listening ? "#EF476F" : "#C4B5FD", fontSize: 20, cursor: "pointer",
        animation: listening ? "restPulse 1s ease-in-out infinite" : "none" }}>🎤</button>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: heard ? "#F0EDE8" : "#777", lineHeight: 1.35 }}>
        {heard ? `„${heard}"` : listening ? "Ich höre zu…" : <>Sag z. B. <b style={{ color: "#aaa" }}>„80 Kilo 8 Wiederholungen fertig"</b></>}
      </div>
    </div>
  );
}
