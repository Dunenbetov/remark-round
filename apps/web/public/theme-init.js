// Тема до первого кадра (без вспышки светлого фона): читаем rr.theme и системную настройку.
// Отдельный файл, а не inline в index.html, чтобы CSP в nginx.conf.template держала script-src 'self'.
(function () {
  try {
    var t = localStorage.getItem('rr.theme');
    var dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) {}
})();
