// Service Worker für Akten Ordner App

const CACHE_NAME = 'akten-ordner-cache-v1';
// Liste der Dateien, die für den Offline-Betrieb benötigt werden.
const urlsToCache = [
  '/',
  '/index.html',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  // Wichtig: FontAwesome benötigt auch die Schriftart-Dateien. Fügen Sie diese hinzu.
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-regular-400.woff2',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2'
];

// Event: 'install'
// Wird ausgelöst, wenn der Service Worker zum ersten Mal registriert wird.
self.addEventListener('install', event => {
  // Wir warten, bis der Cache geöffnet und alle unsere App-Dateien hinzugefügt wurden.
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache geöffnet');
        return cache.addAll(urlsToCache);
      })
  );
});

// Event: 'fetch'
// Wird bei jeder Netzwerkanfrage (z.B. Laden eines Bildes, einer CSS-Datei) ausgelöst.
self.addEventListener('fetch', event => {
  event.respondWith(
    // Wir prüfen zuerst, ob die angeforderte Datei im Cache vorhanden ist.
    caches.match(event.request)
      .then(response => {
        // Wenn die Datei im Cache gefunden wird, geben wir sie von dort zurück.
        if (response) {
          return response;
        }
        // Wenn nicht, versuchen wir, sie aus dem Netzwerk zu laden.
        return fetch(event.request);
      }
    )
  );
});
