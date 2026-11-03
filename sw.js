const VERSION='growth-shell-v38';
const SHELL=['./','./index.html','./app/main.js','./app/core.js','./app/store.js','./app/cloud.js','./app/config.js','./app/style.css','./app/content.json','./manifest.webmanifest','./assets/apple-touch-icon.png','./assets/icon-192.png','./assets/icon-512.png','./assets/maskable-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)))});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('growth-shell-')&&k!==VERSION).map(k=>caches.delete(k)));await self.clients.claim()})())});
// 缓存优先：先给旧文件（秒开、省流量），后台再更新；离线可用
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url),base=new URL('./',self.registration.scope);
 if(u.origin!==base.origin||!SHELL.some(p=>new URL(p,base).pathname===u.pathname))return;
 e.respondWith((async()=>{
   const cache=await caches.open(VERSION);
   const hit=await cache.match(e.request);
   const net=fetch(e.request).then(r=>{if(r&&r.ok)cache.put(e.request,r.clone());return r}).catch(()=>null);
   if(hit){e.waitUntil(net);return hit}
   const r=await net;
   if(r)return r;
   if(e.request.mode==='navigate')return (await cache.match(new URL('./index.html',base)))||Response.error();
   return Response.error();
 })());
});
