// 自毁：卸载自己并清空缓存，确保永远加载最新页面
self.addEventListener('install',e=>{self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.map(k=>caches.delete(k)));
  await self.registration.unregister();
  const cs=await self.clients.matchAll({type:'window'});
  cs.forEach(c=>c.navigate(c.url));
})())});
