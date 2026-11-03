const VERSION='growth-shell-v26';
const SHELL=['./','./index.html','./app/main.js','./app/core.js','./app/store.js','./app/cloud.js','./app/config.js','./app/style.css','./app/content.json','./manifest.webmanifest','./assets/apple-touch-icon.png','./assets/icon-192.png','./assets/icon-512.png','./assets/maskable-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)))});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('growth-shell-')&&k!==VERSION).map(k=>caches.delete(k)));await self.clients.claim()})())});
// 网络优先：联网时始终拿最新文件，离线时回退到缓存
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const u=new URL(e.request.url),base=new URL('./',self.registration.scope);
 if(u.origin!==base.origin||!SHELL.some(p=>new URL(p,base).pathname===u.pathname))return;
 e.respondWith((async()=>{
   try{
     const r=await fetch(e.request,{cache:'no-store'});
     if(r&&r.ok){const c=await caches.open(VERSION);await c.put(e.request,r.clone())}
     return r;
   }catch(err){
     const hit=await caches.match(e.request);
     if(hit)return hit;
     if(e.request.mode==='navigate')return (await caches.match(new URL('./index.html',base)))||Response.error();
     return Response.error();
   }
 })());
});
