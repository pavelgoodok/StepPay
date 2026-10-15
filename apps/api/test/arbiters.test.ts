import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { MemoryStore } from "../src/store";

const R = 100;
const DAY = 86_400_000;

async function setup() {
  let t = 1_000_000;
  const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => t });
  const tokens: Record<string, string> = {};
  for (const id of ["anna", "ivan", "expert", "expert2", "admin"]) tokens[id] = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: id } })).json().token;
  const call = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${tokens[who]}` } });
    return { status: r.statusCode, body: r.json() };
  };
  async function thread() {
    const svc = (await call("ivan", "POST", "/services", { title: "Ремонт квартир", category: "Ремонт и строительство", description: "Делаю ремонт под ключ, работаю один.", photos: [] })).body;
    return (await call("anna", "POST", `/services/${svc.id}/chat`, { text: "Здравствуйте" })).body.id as string;
  }
  return { call, thread, advance: (ms: number) => { t += ms; } };
}

describe("реестр приемщиков", () => {
  it("список с репутацией, добавлять в реестр может только администратор", async () => {
    const { call } = await setup();
    const list = (await call("anna", "GET", "/arbiters")).body as { id: string; resolved: number }[];
    expect(list.map((x) => x.id).sort()).toEqual(["expert", "expert2"]);
    expect(list.every((x) => x.resolved === 0)).toBe(true);
    expect((await call("anna", "POST", "/admin/arbiters", { phone: "+79001234567", value: true })).status).toBe(403);
    expect((await call("admin", "POST", "/admin/arbiters", { phone: "+79001234567", value: true })).status).toBe(404);
  });

  it("задача получает приемщика и запасного из реестра, выбор проверяется", async () => {
    const { call, thread } = await setup();
    const th = await thread();
    await call("ivan", "POST", `/chats/${th}/messages`, { text: "Добрый день" });
    await call("anna", "POST", `/chats/${th}/messages`, { text: "Здравствуйте, обсудим условия" });
    const def = (await call("ivan", "POST", `/chats/${th}/task`, { title: "Ремонт ванной", amount: 5000000 })).body;
    const d = (await call("ivan", "GET", `/deals/${def.dealId}`)).body;
    expect(d.arbiterId).toBe("expert");
    expect(d.backupArbiterId).toBe("expert2");
    expect(d.contract ?? null).toBeNull(); // черновик, условия еще не зафиксированы
    await call("ivan", "POST", `/chats/${th}/messages`, { text: "Добрый день" });
    await call("anna", "POST", `/chats/${th}/messages`, { text: "Здравствуйте, обсудим условия" });
    expect((await call("ivan", "POST", `/chats/${th}/task`, { title: "Без запасного", amount: 5000000, arbiterId: "expert2", backupArbiterId: "" })).status).toBe(200);
    await call("ivan", "POST", `/chats/${th}/messages`, { text: "Добрый день" });
    await call("anna", "POST", `/chats/${th}/messages`, { text: "Здравствуйте, обсудим условия" });
    expect((await call("ivan", "POST", `/chats/${th}/task`, { title: "Чужой приемщик", amount: 5000000, arbiterId: "anna" })).status).toBe(400); // не из реестра
    await call("ivan", "POST", `/chats/${th}/messages`, { text: "Добрый день" });
    await call("anna", "POST", `/chats/${th}/messages`, { text: "Здравствуйте, обсудим условия" });
    expect((await call("ivan", "POST", `/chats/${th}/task`, { title: "Тот же", amount: 5000000, arbiterId: "expert", backupArbiterId: "expert" })).status).toBe(400);
  });

  it("запасной решает спор со второй половины срока, репутация считается", async () => {
    const { call, thread, advance } = await setup();
    const th = await thread();
    await call("ivan", "POST", `/chats/${th}/messages`, { text: "Добрый день" });
    await call("anna", "POST", `/chats/${th}/messages`, { text: "Здравствуйте, обсудим условия" });
    const id = (await call("ivan", "POST", `/chats/${th}/task`, { title: "Ремонт ванной", amount: 5000000 })).body.dealId as string;
    await call("ivan", "POST", `/deals/${id}/terms`, { stages: [{ title: "Плитка", amount: 100_000 * R }] });
    await call("ivan", "POST", `/deals/${id}/propose`);
    await call("ivan", "POST", `/deals/${id}/sign`, {});
    expect((await call("anna", "POST", `/deals/${id}/fund`, {})).status).toBe(200);
    expect((await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, {})).status).toBe(200);
    expect((await call("anna", "POST", `/deals/${id}/stages/s1/reject`, { reason: "Криво" })).status).toBe(200);
    expect((await call("expert2", "POST", `/deals/${id}/stages/s1/resolve`, { decision: "pay" })).status).toBe(400); // рано
    advance(8 * DAY);
    expect((await call("expert2", "POST", `/deals/${id}/stages/s1/resolve`, { decision: "pay" })).status).toBe(200);
    const stats = ((await call("anna", "GET", "/arbiters")).body as { id: string; resolved: number; paid: number; refunded: number }[]).find((x) => x.id === "expert2")!;
    expect(stats).toMatchObject({ resolved: 1, paid: 1, refunded: 0 });
  });

  it("приемщик, промолчавший до срока, получает отметку в репутации", async () => {
    const { call, thread, advance } = await setup();
    const th = await thread();
    await call("ivan", "POST", `/chats/${th}/messages`, { text: "Добрый день" });
    await call("anna", "POST", `/chats/${th}/messages`, { text: "Здравствуйте, обсудим условия" });
    const id = (await call("ivan", "POST", `/chats/${th}/task`, { title: "Ремонт ванной", amount: 5000000 })).body.dealId as string;
    await call("ivan", "POST", `/deals/${id}/terms`, { stages: [{ title: "Плитка", amount: 100_000 * R }] });
    await call("ivan", "POST", `/deals/${id}/propose`);
    await call("ivan", "POST", `/deals/${id}/sign`, {});
    await call("anna", "POST", `/deals/${id}/fund`, {});
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, {});
    await call("anna", "POST", `/deals/${id}/stages/s1/reject`, { reason: "Криво" });
    advance(15 * DAY);
    await call("anna", "POST", "/system/tick");
    const e = ((await call("anna", "GET", "/arbiters")).body as { id: string; silent: number }[]).find((x) => x.id === "expert")!;
    expect(e.silent).toBe(1);
  });
});
