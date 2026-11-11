// 在第一次繪製前套用外觀設定，避免閃一下（鍵名與 src/data/prefs.ts 相同）
try {
  var t = localStorage.getItem("pmq.theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
