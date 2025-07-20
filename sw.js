// CyberSec Compass Enterprise Service Worker
// Version 2.0.0

const CACHE_NAME = 'cybersec-compass-v2.0.0';
const STATIC_CACHE = 'cybersec-static-v2.0.0';
const DYNAMIC_CACHE = 'cybersec-dynamic-v2.0.0';

// Files to cache for offline functionality
const STATIC_FILES = [
  '/',
  '/index.html',
  '/manifest.json',
  // Add any additional static assets here
];

// API endpoints to cache
const CACHEABLE_APIS = [
  '/api/threats',
  '/api/compliance',
  '/api/metrics',
  '/api/security-score'
];

// Install event - cache static files
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('Service Worker: Caching static files');
        return cache.addAll(STATIC_FILES);
      })
      .then(() => {
        console.log('Service Worker: Installation complete');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('Service Worker: Installation failed', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cache) => {
            if (cache !== STATIC_CACHE && cache !== DYNAMIC_CACHE) {
              console.log('Service Worker: Deleting old cache', cache);
              return caches.delete(cache);
            }
          })
        );
      })
      .then(() => {
        console.log('Service Worker: Activation complete');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve cached files when offline
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Handle different types of requests
  if (request.method === 'GET') {
    if (isStaticFile(request.url)) {
      // Static files - cache first strategy
      event.respondWith(cacheFirst(request));
    } else if (isAPIRequest(request.url)) {
      // API requests - network first with cache fallback
      event.respondWith(networkFirst(request));
    } else {
      // Other requests - network first
      event.respondWith(networkFirst(request));
    }
  }
});

// Cache-first strategy for static files
async function cacheFirst(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.error('Cache-first strategy failed:', error);
    return new Response('Offline', { status: 503 });
  }
}

// Network-first strategy for dynamic content
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok && shouldCache(request)) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('Network failed, trying cache:', error);
    
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page for navigation requests
    if (request.destination === 'document') {
      return caches.match('/offline.html') || new Response('Offline', { 
        status: 503,
        headers: { 'Content-Type': 'text/html' }
      });
    }
    
    return new Response('Offline', { status: 503 });
  }
}

// Helper functions
function isStaticFile(url) {
  return url.includes('.css') || 
         url.includes('.js') || 
         url.includes('.png') || 
         url.includes('.jpg') || 
         url.includes('.svg') || 
         url.includes('manifest.json');
}

function isAPIRequest(url) {
  return CACHEABLE_APIS.some(api => url.includes(api));
}

function shouldCache(request) {
  const url = new URL(request.url);
  return request.method === 'GET' && 
         !url.pathname.includes('/admin') &&
         !url.searchParams.has('nocache');
}

// Background sync for threat intelligence updates
self.addEventListener('sync', (event) => {
  if (event.tag === 'threat-intel-sync') {
    event.waitUntil(syncThreatIntelligence());
  }
});

async function syncThreatIntelligence() {
  try {
    console.log('Background sync: Updating threat intelligence');
    
    // Fetch latest threat intelligence
    const response = await fetch('/api/threats/latest');
    if (response.ok) {
      const data = await response.json();
      
      // Store in cache for offline access
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put('/api/threats/latest', new Response(JSON.stringify(data)));
      
      // Notify all clients about the update
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'THREAT_INTEL_UPDATE',
          data: data
        });
      });
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Push notifications for critical security alerts
self.addEventListener('push', (event) => {
  console.log('Push notification received');
  
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = { title: 'Security Alert', body: event.data.text() };
    }
  }
  
  const options = {
    title: data.title || 'CyberSec Compass Alert',
    body: data.body || 'New security event detected',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: data.tag || 'security-alert',
    data: data,
    actions: [
      {
        action: 'view',
        title: 'View Dashboard',
        icon: '/icons/view-action.png'
      },
      {
        action: 'dismiss',
        title: 'Dismiss',
        icon: '/icons/dismiss-action.png'
      }
    ],
    vibrate: [200, 100, 200],
    requireInteraction: data.critical || false
  };
  
  event.waitUntil(
    self.registration.showNotification(options.title, options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('Notification clicked:', event.action);
  
  event.notification.close();
  
  if (event.action === 'view') {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true })
        .then((clientList) => {
          // Focus existing window or open new one
          if (clientList.length > 0) {
            return clientList[0].focus();
          }
          return clients.openWindow('/');
        })
    );
  }
});

// Message handler for communication with main app
self.addEventListener('message', (event) => {
  console.log('Service Worker received message:', event.data);
  
  switch (event.data.type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
      
    case 'CACHE_THREAT_DATA':
      cacheThreatData(event.data.payload);
      break;
      
    case 'CLEAR_CACHE':
      clearCache(event.data.cacheType);
      break;
      
    default:
      console.log('Unknown message type:', event.data.type);
  }
});

async function cacheThreatData(data) {
  try {
    const cache = await caches.open(DYNAMIC_CACHE);
    await cache.put('/api/threats/cached', new Response(JSON.stringify(data)));
    console.log('Threat data cached successfully');
  } catch (error) {
    console.error('Failed to cache threat data:', error);
  }
}

async function clearCache(cacheType = 'all') {
  try {
    if (cacheType === 'all' || cacheType === 'dynamic') {
      await caches.delete(DYNAMIC_CACHE);
      console.log('Dynamic cache cleared');
    }
    
    if (cacheType === 'all' || cacheType === 'static') {
      await caches.delete(STATIC_CACHE);
      console.log('Static cache cleared');
    }
  } catch (error) {
    console.error('Failed to clear cache:', error);
  }
}

// Error handling
self.addEventListener('error', (event) => {
  console.error('Service Worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Service Worker unhandled rejection:', event.reason);
});

console.log('CyberSec Compass Service Worker loaded successfully');