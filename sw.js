'use strict';

// 只缓存静态壳，绝不缓存 /api/ 请求、截图或用户输入。
const CACHE_NAME = 'chat-rescue-shell-v1';
const SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 分析接口永远走网络，不写入任何缓存。
  if (url.pathname.startsWith('/api/')) return;
  // Service Worker 自身不缓存，保证更新能生效。
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((cached) => cached || Response.error())),
    );
    return;
  }

  if (
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname === '/manifest.json' ||
    url.pathname.startsWith('/icons/')
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request)
          .then((response) => {
            if (response && response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached || Response.error());
      }),
    );
  }
});
