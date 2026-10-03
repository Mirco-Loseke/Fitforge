# FitForge – Projektregeln

## Code-Struktur (Umzug von index.html in Module)

`index.html` war ein einziger ~14.000-Zeilen-Block (`<script type="text/plain" id="ff-src">`). Er wird Schritt für Schritt in Dateien unter `src/` aufgeteilt.

**So funktioniert es:**
- `src/manifest.json` listet die Module in Lade-Reihenfolge.
- Build (`vite.config.js`, Plugin `ff-precompile-app`): Module werden **vor** den ff-src-Code gehängt und zusammen kompiliert.
- Dev/In-Browser-Loader (unten in `index.html`): lädt dieselben Dateien per `fetch` und hängt sie ebenfalls davor.
- Alles läuft in **einem gemeinsamen Scope** (kein `import`/`export`). Module dürfen globale Helfer (`IC`, `s`, `ToBody`, `ffVibrate`, `useState` …) nur **innerhalb von Funktionen** benutzen, nicht auf oberster Ebene – die stehen erst danach im ff-src-Code.

**Regeln:**
1. **Neue Features/Komponenten kommen immer in eine eigene Datei** unter `src/modules/<thema>.jsx` und werden in `src/manifest.json` eingetragen – nicht mehr in `index.html`.
2. Beim Anfassen eines größeren, abgeschlossenen Bereichs in `index.html`: wenn sinnvoll gleich nach `src/modules/` auslagern (eigener Commit).
3. Ein Modul = ein Thema (z. B. `barcode-scanner.jsx`, `gps-route.jsx`, `workout-logger.jsx`).
4. Nach jeder Änderung: `npx vite build` muss durchlaufen.

**Bereits ausgelagert:** ai-client (ffAskAI, Cache, ffRichText), ai-coach-insights (Vollkontext, Chat-Diagramme, Chatverlauf), barcode-scanner, gps-route, daily-readiness (Tagesform-Coach), voice-log (Sprach-Logging), run-coach (Lauf-Ansagen), weekly-story (Wochen-Story), body-composition (Waagen-Werte)

**Nächste Kandidaten:** Rezepte & Einkaufsliste, Schlaf & Gesundheit, KI-Coach-Chat, LogWorkout (groß – in Teilen), Dashboard.

## Firebase
- Firestore-Regeln: `firestore.rules`, Storage-Regeln: `storage.rules` (Projekt `mircos-app`).
- Deploy: `npx firebase-tools deploy --only firestore,storage --project mircos-app`
- Storage-Uploads liegen unter `fitforge/<uid>/<ordner>/…` (`uploadToStorage`).
