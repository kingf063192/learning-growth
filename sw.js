const VERSION='growth-shell-v5';
const SHELL=['./','./index.html','./app/main.js','./app/core.js','./app/store.js','./app/cloud.js','./app/config.js','./app/style.css','./app/content.json','./manifest.webmanifest','./assets/apple-touch-icon.png','./assets/icon-192.png','./assets/icon-512.png','./assets/maskable-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('growth-shell-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const u=new URL(e.request.url),base=new URL('./',self.registration.scope);if(u.origin!==base.origin||!SHELL.some(p=>new URL(p,base).pathname===u.pathname))return;
 e.respondWith(fetch(e.request).then(async r=>{if(r.ok){const c=await caches.open(VERSION);await c.put(e.request,r.clone())}return r}).catch(()=>caches.match(e.request).then(r=>r|| (e.request.mode==='navigate'?caches.match(new URL('./index.html',base)):Response.error()))));});
