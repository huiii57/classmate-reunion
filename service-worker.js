/**
 * service-worker.js — 老地方 PWA 離線快取
 *
 * 策略說明：
 * - HTML / CSS / JS 等靜態資源：Cache First（優先讀快取，加快載入）
 * - Firebase API 請求：Network Only（即時資料不快取）
 * - 圖片（外部網址）：Stale While Revalidate（先回快取，背景更新）
 */

// ── 快取版本號碼 ──────────────────────────────────────────
// 每次更新靜態資源時，修改此版本號，舊快取會自動清除
const CACHE_VERSION = "laodi-v1.2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const IMAGE_CACHE  = `${CACHE_VERSION}-images`;

// ── 預先快取的靜態資源清單 ────────────────────────────────
const PRECACHE_ASSETS = [
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  // Firebase SDK（CDN）
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js",
];

// ── 不快取的網域（Firebase 即時資料）────────────────────────
const BYPASS_ORIGINS = [
  "firestore.googleapis.com",
  "firebase.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebaseinstallations.googleapis.com",
];

// ════════════════════════════════════════════════════════════
// 【安裝階段】預先快取靜態資源
// ════════════════════════════════════════════════════════════
self.addEventListener("install", (event) => {
  console.log(`[SW] 安裝中：${CACHE_VERSION}`);

  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log("[SW] 預先快取靜態資源...");
        // 用 addAll，任一失敗不阻斷安裝
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url =>
            cache.add(url).catch(err => {
              console.warn(`[SW] 無法快取 ${url}:`, err);
            })
          )
        );
      })
      .then(() => {
        // 安裝完成後立刻接管頁面，不需等使用者重新整理
        return self.skipWaiting();
      })
  );
});

// ════════════════════════════════════════════════════════════
// 【啟用階段】清除舊快取
// ════════════════════════════════════════════════════════════
self.addEventListener("activate", (event) => {
  console.log(`[SW] 啟用中：${CACHE_VERSION}`);

  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              // 刪除不屬於當前版本的所有快取
              return name.startsWith("laodi-") && !name.startsWith(CACHE_VERSION);
            })
            .map((name) => {
              console.log(`[SW] 清除舊快取：${name}`);
              return caches.delete(name);
            })
        );
      })
      .then(() => {
        // 立刻接管所有已開啟的分頁
        return self.clients.claim();
      })
  );
});

// ════════════════════════════════════════════════════════════
// 【攔截 Fetch】依請求類型選擇快取策略
// ════════════════════════════════════════════════════════════
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只處理 GET 請求
  if (request.method !== "GET") return;

  // ── 策略 1：Firebase 即時資料 → 直接走網路，不快取 ──
  if (BYPASS_ORIGINS.some(origin => url.hostname.includes(origin))) {
    return; // 不攔截，讓瀏覽器直接發請求
  }

  // ── 策略 2：圖片 → Stale While Revalidate ──────────────
  if (
    request.destination === "image" ||
    /\.(png|jpg|jpeg|gif|webp|svg|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE));
    return;
  }

  // ── 策略 3：HTML 主頁面 → Network First（優先取最新版）──
  if (request.mode === "navigate" || url.pathname.endsWith(".html")) {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // ── 策略 4：其他靜態資源 → Cache First ─────────────────
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// ════════════════════════════════════════════════════════════
// 【快取策略函數】
// ════════════════════════════════════════════════════════════

/**
 * Cache First：先從快取讀取，快取命中直接回傳；未命中才請求網路並存入快取
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("離線中，無法載入資源", {
      status: 503,
      headers: { "Content-Type": "text/plain;charset=UTF-8" }
    });
  }
}

/**
 * Network First：優先請求網路，成功就更新快取；網路失敗才用快取版本
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    // 完全離線且無快取：回傳離線頁面
    return new Response(
      `<!DOCTYPE html>
<html lang="zh-TW">
<head><meta charset="UTF-8"><title>老地方 — 離線中</title>
<style>
  body{background:#0d0a05;color:#f0ead8;font-family:Georgia,serif;
       display:flex;align-items:center;justify-content:center;height:100vh;
       flex-direction:column;text-align:center;gap:16px;}
  h1{font-size:2rem;}p{color:#a89070;font-size:1rem;}
</style></head>
<body>
  <h1>✦ 老地方 ✦</h1>
  <p>目前無網路連線，請確認網路後重新整理。</p>
  <p>🌙 深夜總有辦法的，稍等一下～</p>
</body>
</html>`,
      {
        status: 200,
        headers: { "Content-Type": "text/html;charset=UTF-8" }
      }
    );
  }
}

/**
 * Stale While Revalidate：立刻回傳快取版本（快），背景同時更新快取
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // 背景更新快取（不等待結果）
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // 有快取就先回傳快取，同時背景更新
  return cached || fetchPromise;
}

// ════════════════════════════════════════════════════════════
// 【推播通知】（預留功能，目前未使用）
// ════════════════════════════════════════════════════════════
self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body || "老友在老地方等你！",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-72.png",
    tag: "laodi-notification",
    renotify: true,
    data: { url: "./" }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "老地方", options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "./";
  event.waitUntil(
    clients.matchAll({ type: "window" }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(targetUrl) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

console.log(`[SW] service-worker.js 載入完成，版本：${CACHE_VERSION}`);
