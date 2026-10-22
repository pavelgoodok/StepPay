#!/usr/bin/env node
// Проверка развернутого StepPay снаружи: заголовки, CORS, закрытость служебных адресов, режим демо.
//   node scripts/smoke.mjs https://api.example.com https://steppay.vercel.app
// Выход 0: критичных проблем нет (предупреждения возможны), 1: есть провал.
const [, , apiArg, webArg] = process.argv;
if (!apiArg) {
  console.error("Использование: node scripts/smoke.mjs <адрес API> [адрес сайта]");
  process.exit(2);
}
const api = apiArg.replace(/\/$/, "");
const web = webArg?.replace(/\/$/, "");
const results = [];
const rec = (level, name, detail = "") => {
  results.push({ level, name, detail });
  console.log(`${level.padEnd(4)} ${name}${detail ? `: ${detail}` : ""}`);
};
const pass = (n, d) => rec("OK", n, d);
const warn = (n, d) => rec("WARN", n, d);
const fail = (n, d) => rec("FAIL", n, d);
const t = (u, init = {}) => fetch(u, { ...init, redirect: "manual", signal: AbortSignal.timeout(15000) });

async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    fail(name, `запрос не удался: ${e.cause?.code ?? e.message}`);
  }
}

await step("доступность", async () => {
  const r = await t(api + "/health");
  const j = await r.json().catch(() => ({}));
  r.ok && j.ok ? pass("API отвечает", "/health") : fail("API отвечает", `статус ${r.status}`);
});

await step("заголовки", async () => {
  const r = await t(api + "/health");
  const h = (k) => r.headers.get(k);
  h("x-content-type-options") === "nosniff" ? pass("заголовок nosniff") : fail("заголовок nosniff", "нет");
  h("x-frame-options") === "DENY" ? pass("запрет встраивания") : fail("запрет встраивания", "нет");
  h("referrer-policy") ? pass("referrer-policy") : warn("referrer-policy", "нет");
  (h("content-security-policy") ?? "").includes("default-src 'none'") ? pass("CSP у ответов API") : fail("CSP у ответов API", "нет");
  if (api.startsWith("https://")) h("strict-transport-security") ? pass("HSTS") : fail("HSTS", "нет (NODE_ENV=production не задан?)");
  else if (!/^http:\/\/localhost[:/]/.test(api)) warn("HTTPS", "API открыт не по https: ключи приложения (WebCrypto) по http не работают");
  if (h("x-powered-by")) warn("x-powered-by", h("x-powered-by"));
});

if (web) {
  await step("CORS", async () => {
    const origin = new URL(web).origin;
    const ok = await t(api + "/me", { method: "OPTIONS", headers: { origin, "access-control-request-method": "GET", "access-control-request-headers": "authorization" } });
    ok.headers.get("access-control-allow-origin") === origin ? pass("CORS пускает сайт", origin) : fail("CORS пускает сайт", `ответ: ${ok.headers.get("access-control-allow-origin") ?? "нет заголовка"}. Проверьте CORS_ORIGIN, без него не работает вход`);
    const bad = await t(api + "/me", { method: "OPTIONS", headers: { origin: "https://evil.example", "access-control-request-method": "GET" } });
    const v = bad.headers.get("access-control-allow-origin");
    v && v !== "null" ? fail("CORS не пускает чужой сайт", `разрешил ${v}`) : pass("CORS не пускает чужой сайт");
  });
  await step("сайт", async () => {
    const r = await t(web + "/login");
    r.status === 200 ? pass("сайт отвечает", "/login") : fail("сайт отвечает", `статус ${r.status}`);
    const csp = r.headers.get("content-security-policy") ?? "";
    csp ? (csp.includes("frame-ancestors") ? pass("CSP сайта") : warn("CSP сайта", "без frame-ancestors")) : warn("CSP сайта", "нет (проверьте сборку production)");
    if (csp && !csp.includes(new URL(api).origin)) fail("CSP сайта разрешает запросы к API", `в connect-src нет ${new URL(api).origin}: проверьте NEXT_PUBLIC_API_URL при сборке`);
    else if (csp) pass("CSP сайта разрешает запросы к API");
    web.startsWith("https://") || web.startsWith("http://localhost") ? pass("сайт по https") : warn("сайт по https", "ключи приложения работают только по https или на localhost");
  });
}

await step("закрытые адреса", async () => {
  for (const p of ["/me", "/wallet", "/admin/projects", "/admin/audit", "/deals", "/arbiters"]) {
    const r = await t(api + p);
    r.status === 401 ? pass(`без входа закрыто`, p) : fail("без входа закрыто", `${p} ответил ${r.status}`);
  }
  const forged = await t(api + "/me", { headers: { authorization: "Bearer v2.YW5uYQ.1.forged" } });
  forged.status === 401 ? pass("поддельный токен отклонен") : fail("поддельный токен отклонен", `статус ${forged.status}`);
  const noTicket = await t(api + "/uploads/someid");
  [400, 401, 404].includes(noTicket.status) ? pass("файлы без билета закрыты", String(noTicket.status)) : fail("файлы без билета закрыты", `статус ${noTicket.status}`);
});

await step("режим демо", async () => {
  const r = await t(api + "/auth/demo-users");
  const list = r.ok ? await r.json() : [];
  if (list.length > 0) warn("демо-режим включен", `демо-аккаунтов: ${list.length}. Для публичного запуска поставьте DEMO_MODE=off, для жюри оставьте`);
  else pass("демо-режим выключен");
  const d = await t(api + "/auth/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: "admin" }) });
  list.length === 0 ? (d.status === 404 || d.status === 400 ? pass("вход под демо-администратором закрыт") : fail("вход под демо-администратором закрыт", `статус ${d.status}`)) : warn("вход под демо-администратором", "доступен, пока включено демо");
});

await step("вход администратора", async () => {
  const c = await t(api + "/auth/admin/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "AAAA-AAAA" }) });
  c.status === 401 ? pass("вход администратора по коду закрыт без входа") : fail("вход администратора по коду закрыт без входа", `статус ${c.status}`);
  const p = await t(api + "/auth/passkey/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  p.status === 404 ? pass("passkey выключены") : warn("passkey выключены", `статус ${p.status}: включены переменной PASSKEYS=1`);
});
  const j = c.ok ? await c.json() : {};
  j.challenge ? pass("passkey: запрос на вход выдается") : fail("passkey: запрос на вход выдается", `статус ${c.status}`);
  const bad = await t(api + "/auth/passkey/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge: "x", credentialId: "x", userHandle: "eA==", authenticatorData: "x", clientDataJSON: "x", signature: "x" }) });
  bad.status === 401 ? pass("passkey: мусор отклоняется") : fail("passkey: мусор отклоняется", `статус ${bad.status}`);
});

await step("якоря", async () => {
  const r = await t(api + "/anchors/verify");
  const j = r.ok ? await r.json() : null;
  if (!j) return warn("якоря", `/anchors/verify ответил ${r.status}`);
  j.ok ? pass("якоря: цепочка и история сходятся", `якорей ${j.anchors}`) : fail("якоря: цепочка и история сходятся", `проблем ${typeof j.problems === "number" ? j.problems : "есть"}, деньги ${typeof j.money === "number" ? j.money : "есть"}`);
  const list = await (await t(api + "/anchors")).json();
  const last = list.anchors?.at(-1);
  if (last && !(last.published ?? []).length) warn("якоря не опубликованы вне сервера", "задайте ANCHOR_URL и запустите свидетеля");
  else if (!last) warn("якорей пока нет", "появятся после первых сделок");
});

const bad = results.filter((r) => r.level === "FAIL").length;
const warns = results.filter((r) => r.level === "WARN").length;
console.log(`\nИтог: ${results.length - bad - warns} в порядке, ${warns} предупреждений, ${bad} провалов`);
process.exit(bad ? 1 : 0);
