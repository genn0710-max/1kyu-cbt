const CACHE_NAME = 'cbt-arch-v3.2.5-tremie-pronunciation';
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
        keys.filter((key) => key !== CACHE_NAME).map((key) => {
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// フェッチ制御：完全Network-First（オンライン時は常にサーバーから最新を取得）
// オフライン時のみキャッシュから返す
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        // ネットワーク取得成功時：キャッシュを最新に更新してレスポンスを返す
        if (networkResponse && networkResponse.status === 200) {
          const resClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, resClone);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // ネットワーク切断時（オフライン）：キャッシュからフォールバック
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          const url = new URL(event.request.url);
          if (event.request.mode === 'navigate' || url.pathname.endsWith('index.html') || url.pathname.endsWith('/')) {
            return caches.match('./index.html') || caches.match('./');
          }
          return null;
        });
      })
  );
});
