const CACHE="yanzhu-6b661ed609b3"; const FILES=["./assets/exceljs.min-CENqG6hm.js","./assets/fontkit.es-CFlb1edg.js","./assets/index-Bq7-wtxO.js","./assets/index-BQiiVruS.js","./assets/index-DX8Xk2DL.js","./assets/index-KcwAkiBo.css","./assets/_commonjsHelpers-Cpj98o6Y.js","./icon.svg","./icons/icon-192.png","./icons/icon-512.png","./index.html","./manifest.webmanifest"];
self.addEventListener('install', e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate', e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('yanzhu-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch', e=>{
 const u=new URL(e.request.url); if(e.request.method!=='GET'||u.origin!==self.location.origin) return;
 e.respondWith(caches.open(CACHE).then(async cache=>{const hit=await cache.match(e.request); if(hit)return hit;
 try{const response=await fetch(e.request); if(response.ok)await cache.put(e.request,response.clone()); return response;}
 catch(error){if(e.request.mode==='navigate')return (await cache.match('./index.html')) || Response.error(); throw error;}
 }));
});
