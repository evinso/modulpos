// Applies the saved (or system) theme before the first paint. A separate file because the site's Content-Security-Policy forbids inline scripts.
try {
  var t = localStorage.getItem('cp-theme');
  if (t) document.documentElement.dataset.theme = t;
  else if (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) document.documentElement.dataset.theme = 'light';
} catch (e) { /* storage blocked: keep the default dark theme */ }
