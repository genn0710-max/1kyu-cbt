const CACHE_NAME = 'cbt-arch-v2.4-kutai-pronounce';
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

// インストール時：中核ファイルを即座に全キャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // 外部CDNなどで失敗してもローカル本体は必ずキャッシュするよう個別に処理
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[SW] Precache skipped for:', asset, err);
        }
      }
    })
  );
  self.skipWaiting();
});

// アクティベート時：古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// フェッチ時：完全Cache-First（キャッシュにあれば即返却、オフラインでも100%起動）
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        // バックグラウンドでネットワーク更新を試みる
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {
          // オフラインまたはサーバー未接続時は何もしない（キャッシュが生きているため安心）
        });
        return cachedResponse;
      }

      // キャッシュにない場合はネットワークから取得してキャッシュに保存
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // ネットワーク接続エラー（サーバーが見つからない/オフライン）時
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html') || caches.match('./');
        }
      });
    })
  );
});
