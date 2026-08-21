(() => {
  const STORAGE_KEY = 'knowledge-pilot-theme';
  const root = document.documentElement;

  function preferredTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function updateControls(theme) {
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const next = theme === 'dark' ? 'light' : 'dark';
      button.setAttribute('aria-label', `Use ${next} theme`);
      button.setAttribute('title', `Use ${next} theme`);
      button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      const icon = button.querySelector('[data-theme-icon]');
      const label = button.querySelector('[data-theme-label]');
      if (icon) icon.textContent = theme === 'dark' ? '☀' : '☾';
      if (label) label.textContent = theme === 'dark' ? 'Light' : 'Dark';
    });
  }

  function applyTheme(theme, persist = true) {
    const normalized = theme === 'dark' ? 'dark' : 'light';
    root.dataset.theme = normalized;
    if (persist) localStorage.setItem(STORAGE_KEY, normalized);
    updateControls(normalized);
  }

  function toggleTheme() {
    applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  }

  applyTheme(root.dataset.theme || preferredTheme(), false);
  window.KPTheme = { applyTheme, toggleTheme, preferredTheme };

  document.addEventListener('DOMContentLoaded', () => {
    updateControls(root.dataset.theme || preferredTheme());
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', toggleTheme);
    });
  });
})();
