import { readdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
async function walk(dir) {
  const items = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      items.map((x) =>
        x.isDirectory() ? walk(`${dir}/${x.name}`) : `${dir}/${x.name}`,
      ),
    )
  ).flat();
}
const files = (await walk("dist")).filter((x) => !x.endsWith("/sw.js"));
const digest = createHash("sha256");
for (const file of files) digest.update(await readFile(file));
const cache = `yanzhu-${digest.digest("hex").slice(0, 12)}`;
const shell = files
  .filter((x) => !x.includes("/fonts/"))
  .map((x) => "./" + x.slice(5));
await writeFile(
  "dist/sw.js",
  `const CACHE=${JSON.stringify(cache)}; const FILES=${JSON.stringify(shell)};
self.addEventListener('install', e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate', e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('yanzhu-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch', e=>{
 const u=new URL(e.request.url); if(e.request.method!=='GET'||u.origin!==self.location.origin) return;
 e.respondWith(caches.open(CACHE).then(async cache=>{const hit=await cache.match(e.request); if(hit)return hit;
 try{const response=await fetch(e.request); if(response.ok)await cache.put(e.request,response.clone()); return response;}
 catch(error){if(e.request.mode==='navigate')return (await cache.match('./index.html')) || Response.error(); throw error;}
 }));
});
`,
);
console.log(`PWA shell: ${shell.length} files, ${cache}`);
