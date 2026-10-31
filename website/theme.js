(() => {
  const storageKey = 'grok-workbench-site-theme';
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = 'system';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch {
    // Theme selection still works when browser storage is unavailable.
  }

  function applyTheme() {
    const theme = preference === 'system' ? (systemTheme.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content =
      theme === 'dark' ? '#111916' : '#f7f8f2';
  }

  // Run before the stylesheet loads to avoid flashing the wrong theme.
  applyTheme();
  systemTheme.addEventListener('change', applyTheme);
  document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('theme');
    selector.value = preference;
    selector.addEventListener('change', () => {
      preference = selector.value;
      applyTheme();
      try {
        if (preference === 'system') localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, preference);
      } catch {
        // A blocked write must not prevent changing the current page's theme.
      }
    });
  });
})();
