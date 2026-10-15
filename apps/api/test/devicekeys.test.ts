import { generateKeyPairSync, sign as nodeSign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { MemoryStore } from "../src/store";
import { registerMessage, signMessage, keyIdOf } from "../src/devicekeys";

const R = 100;

/** Устройство пользователя: пара ключей и подпись так же, как у WebCrypto (формат r||s). */
function device() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
  const sign = (text: string, key: KeyObject = privateKey) => nodeSign("sha256", Buffer.from(text), { key, dsaEncoding: "ieee-p1363" }).toString("base64");
  return { spki, sign, id: keyIdOf(spki) };
}

async function setup(signaturePolicy?: "device" | "any") {
  const now = Date.now();
  const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => now, signaturePolicy });
  const tokens: Record<string, string> = {};
  for (const id of ["anna", "ivan", "olga"]) tokens[id] = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: id } })).json().token;
  const call = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${tokens[who]}` } });
    return { status: r.statusCode, body: r.json() };
  };
  const register = async (who: string, d = device(), at = now) => call(who, "POST", "/me/keys", { publicKey: d.spki, label: "Телефон", at, signature: d.sign(registerMessage(who, d.spki, at)) });
  /** сделка, где исполнитель отправил условия: ждет подписей и резерва */
  async function proposed() {
    const svc = (await call("ivan", "POST", "/services", { title: "Ремонт квартир", category: "Ремонт и строительство", description: "Делаю ремонт под ключ, работаю один.", photos: [] })).body;
    const th = (await call("anna", "POST", `/services/${svc.id}/chat`, { text: "Здравствуйте" })).body;
    const id = (await call("ivan", "POST", `/chats/${th.id}/task`, { title: "Ремонт ванной", amount: 5000000 })).body.dealId as string;
    await call("ivan", "POST", `/deals/${id}/terms`, { stages: [{ title: "Плитка", amount: 100_000 * R }] });
    await call("ivan", "POST", `/deals/${id}/propose`);
    const hash = (await call("anna", "GET", `/deals/${id}`)).body.contract.hash as string;
    return { id, hash };
  }
  return { app, call, register, now, proposed };
}

describe("ключи подписи на устройстве", () => {
  it("регистрация требует доказательства владения ключом, ключи можно отзывать", async () => {
    const { call, register, now } = await setup();
    const d = device();
    const other = device();
    // подпись чужим ключом, неверный формат, чужой пользователь в сообщении
    expect((await call("ivan", "POST", "/me/keys", { publicKey: d.spki, at: now, signature: other.sign(registerMessage("ivan", d.spki, now)) })).status).toBe(400);
    expect((await call("ivan", "POST", "/me/keys", { publicKey: "AAAA", at: now, signature: "AAAA" })).status).toBe(400);
    expect((await call("ivan", "POST", "/me/keys", { publicKey: d.spki, at: now, signature: d.sign(registerMessage("anna", d.spki, now)) })).status).toBe(400);
    expect((await call("ivan", "POST", "/me/keys", { publicKey: d.spki, at: now - 3 * 86_400_000, signature: d.sign(registerMessage("ivan", d.spki, now - 3 * 86_400_000)) })).status).toBe(400); // устаревший запрос
    expect((await register("ivan", d)).status).toBe(200);
    expect((await register("ivan", d)).status).toBe(400); // дубль
    expect((await call("ivan", "GET", "/me/keys")).body).toMatchObject([{ id: d.id, active: true }]);
    expect((await call("anna", "GET", "/me/keys")).body).toEqual([]); // чужие ключи не видны
    expect((await call("anna", "POST", `/me/keys/${d.id}/revoke`)).status).toBe(404);
    expect((await call("ivan", "POST", `/me/keys/${d.id}/revoke`)).status).toBe(200);
    expect((await call("ivan", "GET", "/me/keys")).body[0]).toMatchObject({ active: false });
    for (let i = 0; i < 5; i++) expect((await register("olga")).status).toBe(200);
    expect((await register("olga")).status).toBe(400); // не больше пяти активных
  });

  it("контракт подписывается ключом устройства, подпись проверяется и хранится вместе с ключом", async () => {
    const { call, register, now, proposed } = await setup();
    const ivan = device();
    const anna = device();
    await register("ivan", ivan);
    await register("anna", anna);
    const { id, hash } = await proposed();
    // с ключом серверная подпись недоступна, нужна подпись устройства
    expect((await call("ivan", "POST", `/deals/${id}/sign`, {})).status).toBe(400);
    const msg = signMessage(id, hash, "ivan", now);
    const ok = await call("ivan", "POST", `/deals/${id}/sign`, { proof: { keyId: ivan.id, message: msg, signature: ivan.sign(msg) } });
    expect(ok.status).toBe(200);
    let d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.signatureStatus).toMatchObject({ signed: ["ivan"], valid: { ivan: true } });
    expect(d.signatures.ivan.proof).toMatchObject({ alg: "ES256", keyId: ivan.id, publicKey: ivan.spki, message: msg });
    expect(d.journal.at(-1)).toMatchObject({ type: "signed", by: "ivan", data: { method: "device", keyId: ivan.id } });
    // деньги резервируются без серверной подписи за заказчика, пока он не подписал сам
    await call("anna", "POST", `/deals/${id}/fund`, {});
    d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.status).toBe("funding");
    expect(d.signatureStatus.signed).toEqual(["ivan"]);
    const msgA = signMessage(id, hash, "anna", now);
    expect((await call("anna", "POST", `/deals/${id}/sign`, { proof: { keyId: anna.id, message: msgA, signature: anna.sign(msgA) } })).status).toBe(200);
    d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.status).toBe("active");
    expect(d.signatureStatus).toMatchObject({ complete: true, valid: { ivan: true, anna: true } });
  });

  it("подделки отклоняются: чужая сделка, другой хеш, чужой пользователь, чужой ключ, отозванный ключ, порча подписи", async () => {
    const { call, register, now, proposed } = await setup();
    const ivan = device();
    const anna = device();
    const stranger = device();
    await register("ivan", ivan);
    await register("anna", anna);
    const { id, hash } = await proposed();
    const attempt = (who: string, key: ReturnType<typeof device>, message: string, keyId = key.id, signature = key.sign(message)) =>
      call(who, "POST", `/deals/${id}/sign`, { proof: { keyId, message, signature } });
    expect((await attempt("ivan", ivan, signMessage("другая-сделка", hash, "ivan", now))).status).toBe(400);
    expect((await attempt("ivan", ivan, signMessage(id, "0".repeat(64), "ivan", now))).status).toBe(400);
    expect((await attempt("ivan", ivan, signMessage(id, hash, "anna", now))).status).toBe(400); // в сообщении другой подписант
    expect((await attempt("ivan", stranger, signMessage(id, hash, "ivan", now), ivan.id)).status).toBe(400); // подпись чужим ключом под своим отпечатком
    expect((await attempt("ivan", stranger, signMessage(id, hash, "ivan", now))).status).toBe(400); // ключ не зарегистрирован
    expect((await attempt("ivan", anna, signMessage(id, hash, "ivan", now), anna.id)).status).toBe(400); // чужой зарегистрированный ключ
    expect((await attempt("ivan", ivan, signMessage(id, hash, "ivan", now - 3 * 86_400_000))).status).toBe(400); // слишком старая подпись
    expect((await attempt("ivan", ivan, signMessage(id, hash, "ivan", now), ivan.id, ivan.sign("другой текст"))).status).toBe(400); // подпись не от этого сообщения
    // отозванный ключ
    await call("ivan", "POST", `/me/keys/${ivan.id}/revoke`);
    expect((await attempt("ivan", ivan, signMessage(id, hash, "ivan", now))).status).toBe(400);
    // после отзыва без ключей доступна серверная подпись (политика any)
    expect((await call("ivan", "POST", `/deals/${id}/sign`, {})).status).toBe(200);
    const d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.signatureStatus.valid.ivan).toBe(true);
    expect(d.signatures.ivan.proof).toBeUndefined();
  });

  it("строгая политика: без ключа подписать нельзя, автоподписи за пользователя нет", async () => {
    const { call, register, now, proposed } = await setup("device");
    const { id, hash } = await proposed();
    expect((await call("ivan", "POST", `/deals/${id}/sign`, {})).status).toBe(400);
    let d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.signatureStatus.signed).toEqual([]); // исполнитель не подписан автоматически при отправке условий
    const ivan = device();
    await register("ivan", ivan);
    const msg = signMessage(id, hash, "ivan", now);
    expect((await call("ivan", "POST", `/deals/${id}/sign`, { proof: { keyId: ivan.id, message: msg, signature: ivan.sign(msg) } })).status).toBe(200);
    d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.signatureStatus.signed).toEqual(["ivan"]);
  });

  it("подпись нельзя использовать повторно после смены условий: хеш другой", async () => {
    const { call, register, now, proposed } = await setup();
    const ivan = device();
    await register("ivan", ivan);
    const { id, hash } = await proposed();
    const msg = signMessage(id, hash, "ivan", now);
    const proof = { keyId: ivan.id, message: msg, signature: ivan.sign(msg) };
    await call("ivan", "POST", `/deals/${id}/reopen`, {});
    await call("ivan", "POST", `/deals/${id}/terms`, { stages: [{ title: "Плитка", amount: 90_000 * R }] });
    await call("ivan", "POST", `/deals/${id}/propose`);
    expect((await call("ivan", "POST", `/deals/${id}/sign`, { proof })).status).toBe(400); // старый хеш
  });
});
