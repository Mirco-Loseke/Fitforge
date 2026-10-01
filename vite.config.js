import { defineConfig, transformWithEsbuild } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { execSync } from 'node:child_process'

// Kompiliert den JSX-App-Code aus <script type="text/plain" id="ff-src"> schon beim Build.
// Im Browser muss dann weder Babel geladen noch 500 KB JSX übersetzt werden.
// Der App-Loader in index.html erkennt data-compiled und lädt die fertige Datei.
// Im Dev-Server (npm run dev) bleibt alles beim In-Browser-Kompilieren.
function precompileApp() {
  const SRC_RE = /(<script type="text\/plain" id="ff-src">)([\s\S]*?)(<\/script>)/
  let fileName = null, code = null
  return {
    name: 'ff-precompile-app',
    apply: 'build',
    async buildStart() {
      const html = readFileSync('index.html', 'utf8')
      const m = html.match(SRC_RE)
      if (!m) throw new Error('ff-src Block nicht gefunden')
      // Ausgelagerte Module aus src/manifest.json vor den Hauptcode setzen
      const mods = JSON.parse(readFileSync('src/manifest.json', 'utf8'))
        .map(f => `\n// ── src/${f}\n` + readFileSync('src/' + f, 'utf8')).join('\n')
      const out = await transformWithEsbuild(mods + '\n' + m[2], 'app.jsx', {
        loader: 'jsx', jsx: 'transform', jsxFactory: 'React.createElement', jsxFragment: 'React.Fragment',
        minify: true, keepNames: true, target: 'es2020',
      })
      code = out.code
      fileName = `assets/app-${createHash('sha256').update(code).digest('hex').slice(0, 10)}.js`
    },
    transformIndexHtml(html) {
      let commit = ''
      try { commit = execSync('git rev-parse --short HEAD').toString().trim() } catch {}
      if (!commit) commit = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7)
      const d = new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: '2-digit' })
      const version = [d, commit].filter(Boolean).join(' · ')
      return html
        .replace(SRC_RE, `<script type="text/plain" id="ff-src" data-compiled="/${fileName}"></script>`)
        .replace('<head>', `<head><script>window.__FF_VERSION__=${JSON.stringify(version)}</script>`)
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName, source: code })
    },
  }
}

export default defineConfig({
  plugins: [react(), precompileApp()],
})
