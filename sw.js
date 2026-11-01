/**
 * KuisPintar SD — Service Worker Engine
 * Versi: v2.7.0
 * Strategi Caching: Stale-While-Revalidate untuk aset lokal, Network-Only untuk Cloud API
 */

const CACHE_NAME = 'kuispintar-v2.7.0';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './pwa.js',
  './data-soal.js',
  './manifest.webmanifest',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon.svg'
];

// 1. Install Event: Cache seluruh berkas inti aplikasi
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Pre-caching aset aplikasi inti...');
      return cache.addAll(CORE_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    }).catch((err) => {
      console.warn('[ServiceWorker] Gagal pre-cache beberapa aset:', err);
    })
  );
});

// 2. Activate Event: Bersihkan cache versi lama
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Menghapus cache usang:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// 3. Fetch Event: Stale-While-Revalidate
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Jangan sentuh request non-GET (seperti POST Google Apps Script)
  if (req.method !== 'GET') {
    return;
  }

  // Bypass Google Apps Script & domain eksternal dinamis
  if (url.hostname.includes('script.google.com') || 
      url.hostname.includes('script.googleusercontent.com') ||
      url.protocol.startsWith('chrome-extension')) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      // Background fetch untuk memperbarui cache (Stale-While-Revalidate)
      const fetchPromise = fetch(req).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(req, responseToCache);
          });
        }
        return networkResponse;
      }).catch((err) => {
        // Mode offline tanpa jaringan
        console.log('[ServiceWorker] Offline - Menyajikan dari cache:', req.url);
      });

      // Kembalikan versi cache jika ada, atau tunggu hasil network
      return cachedResponse || fetchPromise || caches.match('./index.html');
    })
  );
});

