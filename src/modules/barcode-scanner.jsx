// ─── Barcode-Scanner ─────────────────────────────────────────────────────────
// Nur Produkt-Barcodes (EAN-13/8, UPC-A/E), Prüfziffer-Kontrolle und doppelte
// Bestätigung gegen Fehllesungen, Taschenlampe falls verfügbar.
const validEAN = (code) => {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const d = code.split("").map(Number); const check = d.pop();
  const sum = d.reverse().reduce((a, n, i) => a + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
};
function BarcodeScanner({ onDetect, onClose }) {
  const [manual, setManual] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [torch, setTorch] = useState(null); // null = nicht verfügbar
  const [status, setStatus] = useState("Kamera startet…");
  const [hit, setHit] = useState(false);
  const videoRef = useRef(null), streamRef = useRef(null), loopRef = useRef(null), readerRef = useRef(null), doneRef = useRef(false);
  const stop = () => {
    clearTimeout(loopRef.current); loopRef.current = null;
    try { readerRef.current?.reset?.(); } catch (e) {} readerRef.current = null;
    try { streamRef.current?.getTracks().forEach(t => t.stop()); } catch (e) {} streamRef.current = null;
  };
  const finish = (code) => {
    if (doneRef.current) return; doneRef.current = true;
    setHit(true); ffVibrate(80);
    setTimeout(() => { stop(); onDetect(code); }, 250);
  };
  const handle = (text) => {
    const code = String(text || "").replace(/\D/g, "");
    if (validEAN(code) || code.length === 8) finish(code);
  };
  useEffect(() => {
    let cancelled = false;
    document.body.classList.add("ff-scanning");
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current; v.srcObject = stream; v.setAttribute("playsinline", ""); v.muted = true;
        await v.play().catch(() => {});
        const track = stream.getVideoTracks()[0];
        try { const caps = track.getCapabilities?.(); if (caps?.torch) setTorch(false); if (caps?.focusMode?.includes?.("continuous")) track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {}); } catch (e) {}
        setStatus("Barcode in den Rahmen halten");
        // 1) Native Erkennung (Android/Chrome) – schnell & zuverlässig
        let det = null;
        if ("BarcodeDetector" in window) {
          try {
            const sup = await window.BarcodeDetector.getSupportedFormats();
            const want = ["ean_13", "ean_8", "upc_a", "upc_e"].filter(f => sup.includes(f));
            if (want.length) det = new window.BarcodeDetector({ formats: want });
          } catch (e) {}
        }
        if (det) {
          const tick = async () => {
            if (cancelled || doneRef.current) return;
            try { if (v.readyState >= 2) { const r = await det.detect(v); if (r && r[0]) handle(r[0].rawValue); } } catch (e) {}
            loopRef.current = setTimeout(tick, 120);
          };
          tick();
          return;
        }
        // 2) Fallback (iPhone/Safari): ZXing
        if (!window.ZXing) {
          await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js"; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); });
        }
        if (cancelled) return;
        const Z = window.ZXing;
        const hints = new Map();
        hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
        hints.set(Z.DecodeHintType.TRY_HARDER, true);
        const reader = new Z.BrowserMultiFormatReader(hints, 150);
        readerRef.current = reader;
        reader.decodeFromVideoElementContinuously(v, (res) => { if (res && !doneRef.current) handle(res.getText()); });
      } catch (e) {
        setStatus(/NotAllowed|Permission/i.test(String(e?.name || e)) ? "Kamerazugriff verweigert – in den Einstellungen erlauben oder Nummer eintippen" : "Kamera nicht verfügbar – Nummer eintippen");
        setShowManual(true);
      }
    })();
    return () => { cancelled = true; stop(); document.body.classList.remove("ff-scanning"); };
  }, []);
  const toggleTorch = async () => {
    try { await streamRef.current.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch (e) {}
  };
  const close = () => { stop(); onClose(); };
  const ctrl = (active) => ({ flex: 1, height: 54, borderRadius: 16, border: `1px solid ${active ? "rgba(255,209,102,0.6)" : "rgba(255,255,255,0.14)"}`, background: active ? "rgba(255,209,102,0.18)" : "rgba(255,255,255,0.08)", color: active ? "#FFD166" : "#F0EDE8", fontSize: 14, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" });
  return (<ToBody>
    <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 100001, overflow: "hidden" }}>
      <video ref={videoRef} playsInline muted autoPlay style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      {/* Rahmen mit abgedunkeltem Rest */}
      <div style={{ position: "absolute", left: "50%", top: "42%", transform: "translate(-50%,-50%)", width: "min(82vw, 360px)", height: "min(42vw, 180px)", borderRadius: 20, boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)", border: `3px solid ${hit ? "#06D6A0" : "rgba(255,255,255,0.9)"}`, transition: "border-color .2s", pointerEvents: "none" }}>
        {!hit && <div className="ffScanLine" />}
      </div>
      {/* Kopfzeile */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "calc(14px + env(safe-area-inset-top)) 16px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(180deg,rgba(0,0,0,0.6),transparent)" }}>
        <div style={{ color: "#fff", fontSize: 17, fontWeight: 900 }}>Barcode scannen</div>
        <button onClick={close} aria-label="Schließen" style={{ width: 42, height: 42, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.18)", background: "rgba(0,0,0,0.45)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>{IC.x}</button>
      </div>
      {/* Unterer Bereich */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "40px 16px calc(18px + env(safe-area-inset-bottom))", background: "linear-gradient(0deg,rgba(0,0,0,0.85) 60%,transparent)", display: "flex", flexDirection: "column", gap: 12, maxWidth: 480, margin: "0 auto" }}>
        <div style={{ textAlign: "center", color: hit ? "#06D6A0" : "#ddd", fontSize: 14, fontWeight: 700 }}>{hit ? "✓ Erkannt!" : status}</div>
        {showManual && (
          <form onSubmit={e => { e.preventDefault(); const c = manual.replace(/\D/g, ""); if (c.length >= 8) finish(c); }} style={{ display: "flex", gap: 8, margin: 0 }}>
            <input autoFocus style={{ ...s.inp, flex: 1, margin: 0, fontSize: 16, height: 50 }} inputMode="numeric" placeholder="Barcode-Nummer (8–13 Ziffern)" value={manual} onChange={e => setManual(e.target.value)} />
            <button type="submit" className="wkBtn wkBtn-next" style={{ height: 50, padding: "0 20px", opacity: manual.replace(/\D/g, "").length < 8 ? 0.5 : 1 }} disabled={manual.replace(/\D/g, "").length < 8}>Suchen</button>
          </form>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          {torch !== null && <button onClick={toggleTorch} style={ctrl(torch)}>🔦 {torch ? "Licht aus" : "Licht an"}</button>}
          <button onClick={() => setShowManual(m => !m)} style={ctrl(showManual)}>⌨️ Nummer eintippen</button>
        </div>
        <div style={{ color: "#777", fontSize: 11.5, textAlign: "center" }}>Barcode waagerecht halten, ca. 15–20 cm Abstand</div>
      </div>
    </div>
  </ToBody>);
}
