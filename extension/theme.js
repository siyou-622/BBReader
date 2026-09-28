// Apply the saved theme before first paint. MV3 forbids inline scripts, so this is a tiny classic script.
// Stored per browser profile in localStorage; missing or unreadable storage falls back to the defaults.
(()=>{
  try{
    const t=JSON.parse(localStorage.getItem('bbreader-theme')||'{}'),root=document.documentElement;
    if(/^(navy|indigo|teal|terracotta|graphite)$/.test(t.palette))root.dataset.palette=t.palette;
    if(t.mode==='light'||t.mode==='dark')root.dataset.mode=t.mode;
  }catch{}
})();
