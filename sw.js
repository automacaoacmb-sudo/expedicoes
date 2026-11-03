/* Modo offline do app de expedição.
 * - Páginas: tenta a internet primeiro (pega atualizações) e cai na cópia salva se estiver sem sinal.
 * - Ícones, manifesto e comum.js: usa a cópia salva.
 * - Servidor (Google Apps Script): sempre pela internet; quem guarda os lançamentos sem sinal é a fila do app. */
const VERSAO = 'exped-1.1.4';
const SHELL = ['./', './index.html', './comum.js', './almoxarifado.html', './financeiro.html', './manifest.webmanifest', './manifest-almox.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // servidor, Google e bibliotecas: sempre rede

  if (req.mode === 'navigate') {
    // cada página é guardada com o próprio nome (o app em ./index.html), para uma não sobrescrever a outra
    const chave = /\/(index\.html)?$/.test(url.pathname) ? './index.html' : url.pathname;
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then(c => c.put(chave, copia)); }
      return r;
    }).catch(() => caches.match(chave).then(r => r || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
