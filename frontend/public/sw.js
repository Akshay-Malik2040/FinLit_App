const STATIC_CACHE = 'finlit-static-v2'
const RUNTIME_CACHE = 'finlit-runtime-v2'

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.svg',
  '/icon-512.svg',
  '/icons.svg'
]

// Install: Pre-cache essential app shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  )
})

// Activate: Clean up older cache versions immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      })
      .then(() => self.clients.claim())
  )
})

// Fetch strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip non-GET requests and non-http(s) schemes
  if (event.request.method !== 'GET' || !url.protocol.startsWith('http')) {
    return
  }

  // 1. API Requests: Network-first with cache fallback
  if (url.pathname.startsWith('/api')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone()
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, copy))
          }
          return response
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached
            return new Response(
              JSON.stringify({
                success: false,
                error: {
                  code: 'OFFLINE',
                  message: 'You are currently offline. Actions will sync automatically when back online.',
                },
              }),
              { headers: { 'Content-Type': 'application/json' }, status: 503 }
            )
          })
        })
    )
    return
  }

  // 2. Google Fonts & Static CDNs: Cache-First
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone()
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(event.request, responseClone))
          }
          return networkResponse
        })
      })
    )
    return
  }

  // 3. Static Assets & App Shell: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone()
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(event.request, responseToCache)
            })
          }
          return networkResponse
        })
        .catch(() => {
          // If offline and request is HTML navigation, fallback to cached /index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html').then((indexCached) => indexCached || caches.match('/'))
          }
          return cachedResponse
        })

      return cachedResponse || fetchPromise
    })
  )
})
