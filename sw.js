const CACHE_NAME = 'lair-os-v1';
const ASSETS = ['/', '/index.html', '/lair.html', '/admin.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  // Pass-through fetch for clean network requests
});

self.addEventListener('push', (event) => {
  if (!(self.Notification && self.Notification.permission === 'granted')) return;
  
  const data = event.data ? event.data.json() : { title: 'The Lair OS', body: 'New System Event' };
  
  const options = {
    body: data.body,
    icon: '/icon.png', 
    badge: '/icon.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' }
  };
  
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});