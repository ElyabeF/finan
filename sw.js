// FinEly Service Worker: notificações inteligentes de vencimento
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

async function checkDue() {
  const cache = await caches.open("fin-due");
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
