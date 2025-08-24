const CACHE_NAME = 'akten-ordner-cache-v5'; // Version erhöht
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2'
];

// Event: 'install'
// Wird ausgelöst, wenn der Service Worker zum ersten Mal registriert wird.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache wird geöffnet und Dateien werden hinzugefügt');
        return cache.addAll(urlsToCache);
      })
      .then(() => self.skipWaiting()) // Erzwingt, dass der neue Service Worker sofort aktiv wird.
  );
});

// Event: 'activate'
// Wird ausgelöst, nachdem der Service Worker installiert wurde und bereit ist, die Kontrolle zu übernehmen.
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        // Löscht alle alten Caches, die nicht mehr benötigt werden.
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Alter Cache wird gelöscht:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Übernimmt sofort die Kontrolle über alle offenen App-Seiten.
  );
});

// Event: 'fetch'
// Wird bei jeder Netzwerkanfrage der App ausgelöst.
self.addEventListener('fetch', event => {
  event.respondWith(
    // Versucht zuerst, die Anfrage aus dem Cache zu beantworten.
    caches.match(event.request)
      .then(response => {
        // Wenn eine Antwort im Cache gefunden wird, wird diese zurückgegeben.
        // Andernfalls wird die Anfrage normal über das Netzwerk gesendet.
        return response || fetch(event.request);
      })
  );
});
