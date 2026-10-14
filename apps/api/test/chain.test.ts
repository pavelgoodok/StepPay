import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { MemoryStore } from "../src/store";
import type { ChainMethod, ChainPort, ChainSnapshot, CreateArgs } from "../src/chain";

const R = 100;
let t = 1_000_000;

/** Подделка сети: записывает вызовы и отдает заранее заданную сверку. */
function fakeChain() {
  const calls: string[] = [];
  let n = 0;
  const port: ChainPort & { calls: string[]; snap?: ChainSnapshot; failOn?: ChainMethod; tokens?: number } = {
    calls,
    info: () => ({ network: "Тестовая", chainId: 11155111, contract: "0x" + "ab".repeat(20), token: "0x" + "cd".repeat(20), explorer: "https://sepolia.etherscan.io" }),
    addressOf: (a) => "0x" + Buffer.from(a).toString("hex").padEnd(40, "0").slice(0, 40),
    create: async (a: CreateArgs) => {
      calls.push(`create ${a.mode} ${a.executor}>${a.owner ?? "-"} ${a.stages.join("+")}`);
      return { dealId: ++n, hash: "0x" + String(n).padStart(64, "1") };
    },
    prepare: async (a, tokens) => void calls.push(`prepare ${a} ${tokens ?? 0}`),
    send: async (a, m) => {
      if (port.failOn === m) throw new Error("контракт отказал");
      calls.push(`${m} ${a}`);
      return "0x" + calls.length.toString(16).padStart(64, "2");
    },
    wallet: async (a) => ({ address: "0x" + Buffer.from(a).toString("hex").padEnd(40, "0").slice(0, 40), eth: "3000000000000000", tokens: port.tokens ?? 0 }),
    faucet: async (a, amount) => {
      port.tokens = (port.tokens ?? 0) + amount;
      calls.push(`faucet ${a} ${amount}`);
      return "0x" + "f".repeat(64);
    },
    snapshot: async () => port.snap ?? { status: "funding", stages: ["pending", "pending"], reserves: {}, totalReserved: 0 },
  };
  return port;
}

async function setup(chain?: ReturnType<typeof fakeChain>) {
  const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => t, chain });
  const mirror = (app as unknown as { mirror?: { idle(): Promise<void> } }).mirror;
  const tokens: Record<string, string> = {};
  for (const id of ["anna", "ivan", "olga", "expert"]) tokens[id] = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: id } })).json().token;
  const call = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${tokens[who]}` } });
    await mirror?.idle();
    return { status: r.statusCode, body: r.json() };
  };
  return { app, call };
}

describe("перенос сделок на контракт в тестовой сети", () => {
  it("без сети всё работает как раньше", async () => {
    const { app, call } = await setup();
    expect((await app.inject({ method: "GET", url: "/chain/status" })).json()).toEqual({ enabled: false });
    const d = await call("anna", "POST", "/deals", { mode: "own", title: "Ремонт", executorId: "ivan", stages: [{ title: "Плитка", amount: 1000 * R }] });
    expect((await call("anna", "GET", `/deals/${d.body.id}`)).body.chainSync).toBeUndefined();
    expect((await call("anna", "GET", `/deals/${d.body.id}/chain/verify`)).status).toBe(404);
  });

  it("действия участников повторяются на контракте, хеши видны в сделке", async () => {
    const chain = fakeChain();
    const { app, call } = await setup(chain);
    expect((await app.inject({ method: "GET", url: "/chain/status" })).json()).toMatchObject({ enabled: true, network: "Тестовая", chainId: 11155111 });
    const d = await call("anna", "POST", "/deals", { mode: "own", title: "Ремонт", executorId: "ivan", stages: [{ title: "Плитка", amount: 1000 * R }] });
    const id = d.body.id as string;
    expect(chain.calls).toEqual([]); // пока никто не подписал и не внес деньги, на контракте ничего нет
    await call("ivan", "POST", `/deals/${id}/sign`, {});
    await call("anna", "POST", `/deals/${id}/sign`, {});
    await call("anna", "POST", `/deals/${id}/fund`, {});
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, { note: "готово" });
    await call("anna", "POST", `/deals/${id}/stages/s1/approve`, {});
    expect(chain.calls[0]).toBe("create own ivan>anna 100000");
    expect(chain.calls.filter((c) => !c.startsWith("prepare"))).toEqual([
      "create own ivan>anna 100000",
      "sign ivan",
      "sign anna",
      "fund anna",
      "submitStage ivan",
      "approveStage anna",
    ]);
    expect(chain.calls).toContain("prepare anna 100000"); // перед резервом участнику выдаются токены на сумму
    const full = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(full.chain).toMatchObject({ network: "Тестовая", dealId: 1, explorer: "https://sepolia.etherscan.io" });
    expect(full.chain.txs.map((x: { label: string }) => x.label)).toEqual(["Создание сделки", "Подпись контракта", "Подпись контракта", "Резерв 1 000 ₽", "Сдача этапа 1", "Приемка этапа 1"]);
    expect(full.chainSync).toMatchObject({ state: "synced", pending: 0 });
  });

  it("сверка: доступна участникам, не посторонним; расхождение видно", async () => {
    const chain = fakeChain();
    const { call } = await setup(chain);
    const d = await call("anna", "POST", "/deals", { mode: "own", title: "Ремонт", executorId: "ivan", stages: [{ title: "Плитка", amount: 1000 * R }] });
    const id = d.body.id as string;
    await call("ivan", "POST", `/deals/${id}/sign`, {});
    await call("anna", "POST", `/deals/${id}/sign`, {});
    await call("anna", "POST", `/deals/${id}/fund`, {});
    expect((await call("olga", "GET", `/deals/${id}/chain/verify`)).status).toBe(403);
    chain.snap = { status: "active", stages: ["active"], reserves: { ivan: 0, anna: 1000 * R }, totalReserved: 1000 * R };
    expect((await call("anna", "GET", `/deals/${id}/chain/verify`)).body).toMatchObject({ ok: true, applied: true, diffs: [] });
    chain.snap = { status: "active", stages: ["active"], reserves: { ivan: 0, anna: 900 * R }, totalReserved: 900 * R };
    const bad = (await call("ivan", "GET", `/deals/${id}/chain/verify`)).body;
    expect(bad.ok).toBe(false);
    expect(bad.diffs.join(" ")).toContain("Резерв");
  });

  it("отказ контракта останавливает перенос сделки и показывает причину, приложение продолжает работать", async () => {
    const chain = fakeChain();
    const { call } = await setup(chain);
    const d = await call("anna", "POST", "/deals", { mode: "own", title: "Ремонт", executorId: "ivan", stages: [{ title: "Плитка", amount: 1000 * R }] });
    const id = d.body.id as string;
    chain.failOn = "sign";
    expect((await call("ivan", "POST", `/deals/${id}/sign`, {})).status).toBe(200);
    const full = (await call("ivan", "GET", `/deals/${id}`)).body;
    expect(full.chainSync.state).toBe("failed");
    expect(full.chainSync.error).toContain("контракт отказал");
    expect(full.status).toBe("funding"); // ядро сделок не пострадало
  });

  it("демонстрационные сделки не переносятся", async () => {
    const chain = fakeChain();
    const { app } = await setup(chain);
    const tok = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: "anna" } })).json().token;
    const list = (await app.inject({ method: "GET", url: "/deals", headers: { authorization: `Bearer ${tok}` } })).json();
    expect(Array.isArray(list)).toBe(true);
    expect(chain.calls).toEqual([]);
  });
});

import { chainFromEnv } from "../src/chain";

describe("настройки сети из переменных", () => {
  const ok = { CHAIN_RPC_URL: "https://rpc.example", CHAIN_ESCROW: "0x" + "ab".repeat(20), CHAIN_TOKEN: "0x" + "cd".repeat(20), CHAIN_DEPLOYER_KEY: "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", CHAIN_WALLET_SEED: "seed" } as NodeJS.ProcessEnv;
  it("пустые переменные: сеть выключена; полные: включена, ключ можно без 0x", () => {
    expect(chainFromEnv({})).toBeUndefined();
    expect(chainFromEnv(ok)?.info().chainId).toBe(11155111);
  });
  it("плохие значения дают понятную ошибку, а не падение внутри библиотеки", () => {
    expect(() => chainFromEnv({ ...ok, CHAIN_DEPLOYER_KEY: "0x123" })).toThrow(/CHAIN_DEPLOYER_KEY/);
    expect(() => chainFromEnv({ ...ok, CHAIN_ESCROW: "0xabc" })).toThrow(/CHAIN_ESCROW/);
    expect(() => chainFromEnv({ ...ok, CHAIN_RPC_URL: "eth-sepolia.example" })).toThrow(/CHAIN_RPC_URL/);
  });
});

describe("кошелек в сети и выдача токенов", () => {
  it("без сети кошелька нет, с сетью виден адрес и баланс, токены выдаются с ограничениями", async () => {
    const off = await setup();
    expect((await off.call("anna", "GET", "/me/chain")).body).toEqual({ enabled: false });
    expect((await off.call("anna", "POST", "/me/chain/faucet", { amount: 100000 })).status).toBe(404);

    const chain = fakeChain();
    const { call } = await setup(chain);
    const w = (await call("anna", "GET", "/me/chain")).body;
    expect(w).toMatchObject({ enabled: true, network: "Тестовая", tokens: 0, eth: "3000000000000000" });
    expect(w.address).toMatch(/^0x[0-9a-f]{40}$/);

    expect((await call("anna", "POST", "/me/chain/faucet", { amount: 1_000_000 })).body).toMatchObject({ ok: true });
    expect((await call("anna", "GET", "/me/chain")).body.tokens).toBe(1_000_000);
    expect((await call("anna", "POST", "/me/chain/faucet", { amount: 100 })).status).toBe(429); // слишком часто
    expect((await call("ivan", "POST", "/me/chain/faucet", { amount: 5_000_000 })).status).toBe(400); // больше 10 000 рублей за раз
    expect((await call("ivan", "POST", "/me/chain/faucet", { amount: 0 })).status).toBe(400);
    t += 31_000;
    chain.tokens = 5_000_000;
    expect((await call("anna", "POST", "/me/chain/faucet", { amount: 100 })).status).toBe(400); // уже достаточно
  });
});
