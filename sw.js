// FinEly Service Worker: cache offline completo (App Shell + fontes + SDKs) e notificações inteligentes de vencimento
const SHELL_CACHE = "finely-shell-v2";
const DUE_CACHE = "fin-due";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== DUE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Nunca intercepta chamadas dinâmicas de API (Firebase Realtime DB / Auth / Gemini API)
  if (
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("googleapis.com") && !url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("identitytoolkit") ||
    url.hostname.includes("securetoken")
  ) {
    return;
  }

  // Navegação principal (HTML): Network-First com fallback para cache offline
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match("./index.html") || caches.match("./")))
    );
    return;
  }

  // Assets estáticos (ícones, manifest, Google Fonts, Firebase SDK): Stale-While-Revalidate
  e.respondWith(
    caches.match(req).then(cached => {
      const netFetch = fetch(req)
        .then(res => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || netFetch;
    })
  );
});

async function checkDue() {
  const cache = await caches.open(DUE_CACHE);
  const res = await cache.match(new Request(self.registration.scope + "due.json"));
  if (!res) return;
  const list = await res.json();
  const now = new Date(); now.setHours(0, 0, 0, 0);
  for (const x of list) {
    const [y, m, d] = x.iso.split("-").map(Number);
    const diff = Math.round((new Date(y, m - 1, d) - now) / 86400000);
    if (diff > 3 || diff < -5) continue;
    const when = diff < 0 ? `venceu há ${-diff} dia(s)` : diff === 0 ? "vence hoje" : diff === 1 ? "vence amanhã" : `vence em ${diff} dias`;
    const prefix = x.kind === "fixa" ? "Fixa" : x.kind === "variavel" ? "Variável" : x.kind === "avulsa" ? "Avulsa" : "Fatura";
    const label = x.subtitle ? `${x.subtitle} (${x.bank})` : x.bank;
    await self.registration.showNotification(`FinEly · ${prefix} ${x.bank}: ${when}`, {
      body: `${label} no valor de ${Number(x.total || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} está pendente.`,
      tag: `due_${x.bank}_${x.iso}`, icon: "icon-192.png", badge: "icon-192.png"
    });
  }
}

self.addEventListener("periodicsync", e => { if (e.tag === "fin-due-check") e.waitUntil(checkDue()); });
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(cs => cs.length ? cs[0].focus() : self.clients.openWindow("./")));
});
