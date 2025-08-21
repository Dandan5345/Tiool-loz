// ---- לו״ז טיול בקלות - Service Worker ----
// גרסה: עדכן כדי לאלץ רענון קאש אחרי פריסה
const VERSION = 'v1.0.0';
const APP_CACHE = `app-cache-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

// דפי ה-App Shell (מה שנתת + בסיס האתר)
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',

  './attractions.html',
  './checklists.html',
  './create-schedule.html',
  './create-trip.html',
  './daily-schedule.html',
  './edit-trip.html',
  './expenses.html',
  './join.html',
  './login.html',
  './redeem.html',
  './summary-edit.html',
  './summary.html',
  './trip.html'
];

// אופציונלי: אם תוסיף offline.html בעתיד, הוסף גם כאן:
// APP_SHELL.push('./offline.html');

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // ניקוי קאש ישנים
      const keys = await caches.keys();
      await Promise.all(
        keys.map(k => (k === APP_CACHE || k === RUNTIME_CACHE) ? null : caches.delete(k))
      );
      // שיפור טעינת ניווטים
      if ('navigationPreload' in self.registration) {
        try { await self.registration.navigationPreload.enable(); } catch {}
      }
      await self.clients.claim();
    })()
  );
});

// האם הבקשה היא ניווט (HTML)?
function isNavigationRequest(request) {
  return request.mode === 'navigate' ||
         (request.method === 'GET' &&
          request.headers.get('accept') &&
          request.headers.get('accept').includes('text/html'));
}

// דומיינים חיצוניים שנרצה לקאש דינאמי (CDN, פונטים, מפות, תמונות)
const RUNTIME_ALLOWLIST = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'images.unsplash.com',
  'i.imgur.com',
  'tile.openstreetmap.org',
  'a.tile.openstreetmap.org',
  'b.tile.openstreetmap.org',
  'c.tile.openstreetmap.org'
];

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) ניווטים (דפי HTML): Network-First עם נפילה לקאש/אופליין
  if (isNavigationRequest(req)) {
    event.respondWith((async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;

        const fresh = await fetch(req);
        // שמירת העותק בקאש האפליקציה
        const cache = await caches.open(APP_CACHE);
        cache.put(req, fresh.clone());
        return fresh;
      } catch {
        // אין רשת → נסה קאש; ואם אין, נפל ל-index.html (או offline.html אם יש)
        const cacheMatch = await caches.match(req);
        if (cacheMatch) return cacheMatch;
        const fallback = await caches.match('./index.html'); // או './offline.html' אם הוספת
        return fallback || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 2) בקשות לאותה מקור (same-origin) – Cache-First (סטטיים)
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        // שמור בריצה כדי שהפעם הבאה תהיה מהירה
        const runtime = await caches.open(RUNTIME_CACHE);
        runtime.put(req, resp.clone());
        return resp;
      } catch {
        // נכשל – נסה משהו דומה מהקאש
        return cached || new Response('', { status: 504, statusText: 'Gateway Timeout' });
      }
    })());
    return;
  }

  // 3) דומיינים חיצוניים מאושרים – Network-First + קאש דינמי
  if (RUNTIME_ALLOWLIST.includes(url.hostname)) {
    event.respondWith((async () => {
      try {
        const resp = await fetch(req, { mode: 'no-cors' /* ל-opaque במידת הצורך */ });
        const runtime = await caches.open(RUNTIME_CACHE);
        runtime.put(req, resp.clone());
        return resp;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        // אם אין כלום בקאש, החזר תגובה ריקה/שגיאה רכה
        return new Response('', { status: 504, statusText: 'Offline (runtime)' });
      }
    })());
    return;
  }

  // 4) ברירת מחדל – נסה קאש ואז רשת
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(() => cached || Response.error()))
  );
});

// תמיכה ב-Skip Waiting דרך הודעה מהעמוד (אם תרצה לעדכן גרסה בלי רילוד ידני)
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});