// عامل خدمة بسيط: يجعل التطبيق قابلاً للتثبيت. لا يخزّن شيئاً حتى تبقى اللعبة محدّثة دائماً.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
