/* BJT 경어 드릴 — offline cache. Version is stamped at build time. */
const VERSION = "76b5b40f22";
const CACHE = "keigo-drill-" + VERSION;
const FONTS = "keigo-drill-fonts";
const AUDIO = "keigo-audio-1";   // Microsoft Nanami clips — kept across app updates (file names are content hashes)
const SHELL = ["./", "./index.html", "./manifest.webmanifest",
  "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("keigo-drill-") && k !== CACHE && k !== FONTS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Audio: cache first; answer Range requests with 206 slices (Safari's media player asks for byte ranges).
async function audio(req) {
  const url = req.url.split("#")[0];
  const cache = await caches.open(AUDIO);
  let res = await cache.match(url, {ignoreSearch: true});
  if (!res) {
    let net;
    try { net = await fetch(url, {credentials: "same-origin"}); }
    catch (err) { return new Response("", {status: 504, statusText: "offline"}); }
    if (!net.ok || net.status !== 200) return net;
    try { await cache.put(url, net.clone()); } catch (err) {}
    res = net;
  }
  const range = req.headers.get("range");
  if (!range) return res;
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === "" && m[2] === "")) {
    return new Response(buf, {status: 200, headers: {"Content-Type": "audio/mpeg", "Content-Length": String(size), "Accept-Ranges": "bytes"}});
  }
  let start, end;
  if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) {
    return new Response("", {status: 416, headers: {"Content-Range": "bytes */" + size}});
  }
  return new Response(buf.slice(start, end + 1), {status: 206, statusText: "Partial Content", headers: {
    "Content-Type": "audio/mpeg", "Content-Range": "bytes " + start + "-" + end + "/" + size,
    "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes"}});
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // The page itself: network first (to pick up updates), cache when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); }
        return res;
      }).catch(() => caches.match("./index.html").then(r => r || caches.match("./")))
    );
    return;
  }

  if (url.origin === self.location.origin && /\/audio\/[0-9a-f]+\.mp3$/.test(url.pathname)) {
    e.respondWith(audio(req));
    return;
  }

  // Same-origin files (icons, manifest): cache first.
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // Google Fonts: serve from cache, refresh in the background.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.open(FONTS).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
  }
});
