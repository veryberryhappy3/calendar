// 家族カレンダー Service Worker
// バージョンを上げるとキャッシュが再生成されます
const CACHE_NAME = 'fam-cal-v1';

// インストール時にキャッシュするファイル（アプリシェル）
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
];

// ── インストール ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── アクティベート（古いキャッシュを削除）────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── フェッチ制御 ──────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // POST など非GETはスルー（GAS同期リクエストがここに該当）
  if (request.method !== 'GET') return;

  // Google系ホスト（GAS・Google Fonts API）はネットワーク優先
  const isGoogle = url.hostname.endsWith('.google.com') ||
                   url.hostname.endsWith('.googleapis.com') ||
                   url.hostname.endsWith('.googleusercontent.com') ||
                   url.hostname.endsWith('.gstatic.com');
  if (isGoogle) {
    // Google Fontsのフォントファイルはキャッシュ可
    if (url.hostname === 'fonts.gstatic.com') {
      event.respondWith(
        caches.match(request).then(cached =>
          cached || fetch(request).then(resp => {
            if (resp.ok) {
              const clone = resp.clone();
              caches.open(CACHE_NAME).then(c => c.put(request, clone));
            }
            return resp;
          })
        )
      );
    }
    // それ以外のGoogleリクエストはそのままネットワークへ
    return;
  }

  // 同一オリジン：キャッシュ優先、なければネットワーク取得してキャッシュ
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return resp;
        }).catch(() =>
          // オフライン時：ナビゲーションリクエストならindex.htmlを返す
          request.mode === 'navigate'
            ? caches.match('./index.html')
            : new Response('', { status: 503 })
        );
      })
    );
  }
});
