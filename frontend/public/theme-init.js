// Runs synchronously in <head> before first paint so the stored theme applies
// without a flash of the default (dark) palette. Mirrors ThemeContext.tsx:
// key 'mindflow-theme', values 'light' | 'dark', else OS preference, else light.
// External file (not inline) so the production CSP `script-src 'self'` allows it.
(function () {
  var theme = 'light';
  try {
    var stored = localStorage.getItem('mindflow-theme');
    if (stored === 'light' || stored === 'dark') {
      theme = stored;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      theme = 'dark';
    }
  } catch {
    /* storage blocked: keep default */
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
