import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Production-only CSP (dev needs inline HMR scripts + websockets). Allows the
// YouTube iframe/API, Google Fonts and the configured backend origin.
function cspPlugin(apiBase: string, supabaseUrl: string): Plugin {
  return {
    name: 'studify-csp',
    apply: 'build',
    transformIndexHtml() {
      const csp = [
        "default-src 'self'",
        "script-src 'self' https://www.youtube.com https://s.ytimg.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob: https:",
        `connect-src 'self' ${apiBase}${supabaseUrl ? ` ${supabaseUrl}` : ''}`,
        'frame-src https://www.youtube.com https://www.youtube-nocookie.com',
        "media-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ')
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' }]
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBase = (env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '')
  const supabaseUrl = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  return {
    plugins: [react(), tailwindcss(), cspPlugin(apiBase, supabaseUrl)],
  }
})
