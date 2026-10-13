import { createHash, generateKeyPairSync, randomBytes, sign as nodeSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { MemoryStore } from "../src/store";
import { keyIdOf, passkeyMessage, signMessage } from "../src/devicekeys";

const R = 100;
const ORIGIN = "https://steppay.example";
const sha = (d: string | Buffer) => createHash("sha256").update(d).digest();

/** Устройство с passkey: ведет себя как аутентификатор WebAuthn (формат authenticatorData и подпись DER). */
function authenticator(opts: { host?: string; flags?: { create?: number; get?: number } } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
  const credId = randomBytes(32);
  const rp = sha(opts.host ?? new URL(ORIGIN).hostname);
  const clientData = (type: string, challenge: Buffer, origin = ORIGIN) => Buffer.from(JSON.stringify({ type, challenge: challenge.toString("base64url"), origin, crossOrigin: false }));
  return {
    spki,
    credentialId: credId.toString("base64url"),
    create(userId: string, at: number, over: { challenge?: Buffer; origin?: string } = {}) {
      const authData = Buffer.concat([rp, Buffer.from([opts.flags?.create ?? 0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([credId.length >> 8, credId.length & 255]), credId, Buffer.alloc(77)]);
      const cd = clientData("webauthn.create", over.challenge ?? sha(passkeyMessage(userId, at)), over.origin);
      return { credentialId: credId.toString("base64url"), publicKey: spki, authenticatorData: authData.toString("base64"), clientDataJSON: cd.toString("base64"), at };
    },
    get(message: string, over: { challenge?: Buffer } = {}) {
      const authData = Buffer.concat([rp, Buffer.from([opts.flags?.get ?? 0x05]), Buffer.alloc(4)]);
      const cd = clientData("webauthn.get", over.challenge ?? sha(message));
      const signature = nodeSign("sha256", Buffer.concat([authData, sha(cd)]), privateKey).toString("base64");
      return { keyId: keyIdOf(spki), message, signature, webauthn: { authenticatorData: authData.toString("base64"), clientDataJSON: cd.toString("base64") } };
    },
  };
}

async function setup(corsOrigin?: string) {
  const now = Date.now();
  const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => now, corsOrigin });
  const tokens: Record<string, string> = {};
  for (const id of ["anna", "ivan"]) tokens[id] = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: id } })).json().token;
  const call = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${tokens[who]}` } });
    return { status: r.statusCode, body: r.json() };
  };
  async function proposed() {
    const svc = (await call("ivan", "POST", "/services", { title: "Ремонт квартир", category: "Ремонт и строительство", description: "Делаю ремонт под ключ, работаю один.", photos: [] })).body;
    const th = (await call("anna", "POST", `/services/${svc.id}/chat`, { text: "Здравствуйте" })).body;
    const id = (await call("ivan", "POST", `/chats/${th.id}/task`, { title: "Ремонт ванной" })).body.dealId as string;
    await call("ivan", "POST", `/deals/${id}/terms`, { stages: [{ title: "Плитка", amount: 100_000 * R }] });
    await call("ivan", "POST", `/deals/${id}/propose`);
    const hash = (await call("anna", "GET", `/deals/${id}`)).body.contract.hash as string;
    return { id, hash };
  }
  return { call, now, proposed };
}

describe("passkeys (WebAuthn)", () => {
  it("регистрация, подпись контракта и проверка", async () => {
    const { call, now, proposed } = await setup();
    const a = authenticator();
    const reg = await call("ivan", "POST", "/me/passkeys", { ...a.create("ivan", now), label: "Телефон" });
    expect(reg.status).toBe(200);
    expect((await call("ivan", "GET", "/me/keys")).body[0]).toMatchObject({ kind: "passkey", credentialId: a.credentialId, active: true });

    const { id, hash } = await proposed();
    const proof = a.get(signMessage(id, hash, "ivan", now));
    const r = await call("ivan", "POST", `/deals/${id}/sign`, { proof });
    expect(r.status).toBe(200);
    const d = (await call("ivan", "GET", `/deals/${id}`)).body;
    expect(d.signatures.ivan.proof.webauthn).toBeTruthy();
    expect(d.contractCheck.ok).toBe(true);
  });

  it("отклоняет подмену: чужой запрос, чужой домен, без проверки пользователя, испорченная подпись", async () => {
    const { call, now, proposed } = await setup();
    const a = authenticator();
    await call("ivan", "POST", "/me/passkeys", a.create("ivan", now));
    const { id, hash } = await proposed();
    const msg = signMessage(id, hash, "ivan", now);

    const other = a.get(msg, { challenge: sha("другое сообщение") });
    expect((await call("ivan", "POST", `/deals/${id}/sign`, { proof: other })).status).toBe(400);

    const evil = authenticator({ host: "evil.example" });
    expect((await call("ivan", "POST", "/me/passkeys", evil.create("ivan", now))).status).toBe(400); // passkey другого домена не регистрируется
    const ok = a.get(msg);
    const raw = Buffer.from(ok.signature, "base64");
    raw[10] = raw[10]! ^ 1;
    const broken = { ...ok, signature: raw.toString("base64") };
    expect((await call("ivan", "POST", `/deals/${id}/sign`, { proof: broken })).status).toBe(400);

    const noUv = authenticator({ flags: { get: 0x01 } });
    const reg = await call("anna", "POST", "/me/passkeys", noUv.create("anna", now));
    expect(reg.status).toBe(200);
    const aMsg = signMessage(id, hash, "anna", now);
    expect((await call("anna", "POST", `/deals/${id}/sign`, { proof: noUv.get(aMsg) })).status).toBe(400);
  });

  it("регистрация отклоняется при неверном запросе, домене, флагах и идентификаторе", async () => {
    const { call, now } = await setup();
    const a = authenticator();
    expect((await call("ivan", "POST", "/me/passkeys", a.create("ivan", now, { challenge: sha("x") }))).status).toBe(400);
    expect((await call("ivan", "POST", "/me/passkeys", a.create("anna", now))).status).toBe(400); // запрос другого пользователя
    expect((await call("ivan", "POST", "/me/passkeys", authenticator({ host: "evil.example" }).create("ivan", now))).status).toBe(400);
    expect((await call("ivan", "POST", "/me/passkeys", authenticator({ flags: { create: 0x41 } }).create("ivan", now))).status).toBe(400); // нет проверки пользователя
    expect((await call("ivan", "POST", "/me/passkeys", { ...a.create("ivan", now), credentialId: "AAAA" })).status).toBe(400);
    expect((await call("ivan", "POST", "/me/passkeys", a.create("ivan", now - 3 * 86_400_000))).status).toBe(400); // старый запрос
  });

  it("при заданном списке сайтов passkey с чужого сайта не принимается", async () => {
    const { call, now } = await setup("https://other.example");
    expect((await call("ivan", "POST", "/me/passkeys", authenticator().create("ivan", now))).status).toBe(400);
    const { call: c2, now: n2 } = await setup(ORIGIN);
    expect((await c2("ivan", "POST", "/me/passkeys", authenticator().create("ivan", n2))).status).toBe(200);
  });

  it("ключ passkey не подписывает обычной подписью, а обычный ключ без passkey-данных", async () => {
    const { call, now, proposed } = await setup();
    const a = authenticator();
    await call("ivan", "POST", "/me/passkeys", a.create("ivan", now));
    const { id, hash } = await proposed();
    const plain = { keyId: keyIdOf(a.spki), message: signMessage(id, hash, "ivan", now), signature: "AAAA" };
    expect((await call("ivan", "POST", `/deals/${id}/sign`, { proof: plain })).status).toBe(400);
  });

  it("отозванный passkey подписывать не может", async () => {
    const { call, now, proposed } = await setup();
    const a = authenticator();
    const { body } = await call("ivan", "POST", "/me/passkeys", a.create("ivan", now));
    await call("ivan", "POST", `/me/keys/${body.id}/revoke`, {});
    const { id, hash } = await proposed();
    expect((await call("ivan", "POST", `/deals/${id}/sign`, { proof: a.get(signMessage(id, hash, "ivan", now)) })).status).toBe(400);
  });
});
