function initReadingShellAccessibility() {
  const root = document.getElementById('reading-shell-root');
  if (!root) return false;

  root.removeAttribute('aria-live');
  const topbar = document.querySelector('.topbar');
  const main = document.getElementById('main-content');
  let active = false;
  let focusPlaced = false;
  let returnFocus = null;

  const setWorkspaceInert = (value) => {
    if (topbar) topbar.inert = value;
    if (main) main.inert = value;
  };

  const restoreWorkspace = () => {
    if (!active) return;
    setWorkspaceInert(false);
    active = false;
    focusPlaced = false;
    const target = returnFocus;
    returnFocus = null;
    if (target?.isConnected && typeof target.focus === 'function') {
      target.focus({ preventScroll: true });
    }
  };

  const sync = () => {
    const readerReady = !root.hidden && Boolean(root.querySelector('.reading-sticky'));
    if (!readerReady) {
      restoreWorkspace();
      return;
    }

    if (!active) {
      const current = document.activeElement;
      returnFocus = current && !root.contains(current) ? current : null;
      setWorkspaceInert(true);
      active = true;
    }

    if (!focusPlaced) {
      const heading = root.querySelector('.reading-hero h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        focusPlaced = true;
      }
    }
  };

  const observer = new MutationObserver(sync);
  observer.observe(root, { attributes: true, attributeFilter: ['hidden'], childList: true });
  window.addEventListener('hashchange', () => queueMicrotask(sync));
  window.addEventListener('pageshow', sync);
  sync();
  return true;
}

if (!initReadingShellAccessibility()) {
  document.addEventListener('DOMContentLoaded', initReadingShellAccessibility, { once: true });
}
