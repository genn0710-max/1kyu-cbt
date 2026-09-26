const CACHE_NAME = 'cbt-arch-v2.9-review-retry';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './questions_bank.js',
  './word_bank.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/vue@3/dist/vue.global.prod.js'
];

// インストール時：中核ファイルを事前キャッシュし、待機せずに即座にアクティベート
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[SW] Precache notice:', asset);
        }
      }
    })
  );
  self.skipWaiting();
});

// アクティベート時：古いキャッシュを即座に破棄し、全クライアントをコントロール下に置く
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// フェッチ制御：HTMLはNetwork-First（常に最新を表示）、オフライン時はキャッシュから爆速起動
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isNavigate = event.request.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname.endsWith('/');

  if (isNavigate) {
    // 🌐 画面（HTML）：ネットワーク優先（最新版を取得）、失敗時（オフライン）のみキャッシュ
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, resClone);
          });
        }
        return networkResponse;
      }).catch(() => {
        // オフライン時のフォールバック
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('./index.html') || caches.match('./');
        });
      })
    );
    return;
  }

  // 📦 その他の静的アセット（JS / CSS / 画像）：Stale-While-Revalidate（キャッシュ返却＋裏で最新取得）
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, resClone);
          });
        }
        return networkResponse;
      }).catch(() => {});

      return cachedResponse || fetchPromise;
    })
  );
});
