import { describe, expect, it } from "vitest";
import { buildApp, type PublicAnchor } from "../src/app";
import { MemoryStore } from "../src/store";

const R = 100;
let t = 1_000_000;
const HOUR = 3_600_000;

async function setup(over: { fail?: boolean } = {}) {
  const store = new MemoryStore();
  const published: PublicAnchor[] = [];
  const app = await buildApp({
    store, secret: "s", now: () => t, anchorEveryMs: HOUR,
    anchorPublish: async (a) => {
      if (over.fail) throw new Error("нет связи");
      published.push(a);
      return { target: "witness.example", ref: `#${a.n}` };
    },
  });
  const tokens: Record<string, string> = {};
  for (const id of ["anna", "ivan", "olga"]) tokens[id] = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: id } })).json().token;
  const call = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${tokens[who]}` } });
    return { status: r.statusCode, body: r.json() };
  };
  const pub = async (url: string) => (await app.inject({ method: "GET", url })).json();
  return { app, store, call, pub, published };
}

async function deal(call: Awaited<ReturnType<typeof setup>>["call"]) {
  const id = (await call("anna", "POST", "/deals", { mode: "own", title: "Сайт", executorId: "ivan", stages: [{ title: "Дизайн", amount: 10_000 * R }] })).body.id as string;
  await call("ivan", "POST", `/deals/${id}/sign`, {});
  await call("anna", "POST", `/deals/${id}/fund`, {});
  return id;
}

describe("якоря истории в API", () => {
  it("фиксируются по расписанию, только если что-то изменилось, и публикуются наружу", async () => {
    t = 1_000_000;
    const { call, pub, published } = await setup();
    expect((await pub("/anchors")).anchors).toEqual([]);
    const id = await deal(call);
    await call("anna", "POST", "/system/tick");
    const list = (await pub("/anchors")).anchors;
    expect(list).toHaveLength(1);
    expect(list[0].published).toEqual([{ at: t, target: "witness.example", ref: "#1" }]);
    expect(published[0]!.root).toBe(list[0].root);
    // без изменений и без времени нового якоря нет
    t += 2 * HOUR;
    await call("anna", "POST", "/system/tick");
    expect((await pub("/anchors")).anchors).toHaveLength(1);
    // изменение раньше срока не создает якорь, после срока создает и продолжает цепочку
    await call("ivan", "POST", `/deals/${id}/stages/s1/submit`, {});
    await call("anna", "POST", "/system/tick");
    const two = (await pub("/anchors")).anchors;
    expect(two).toHaveLength(2);
    expect(two[1].prev).toBe(two[0].root);
    expect((await pub("/anchors/verify")).ok).toBe(true);
    const mine = (await call("anna", "GET", `/deals/${id}/anchors`)).body;
    expect(mine.map((x: { n: number }) => x.n)).toEqual([1, 2]);
    expect((await call("olga", "GET", `/deals/${id}/anchors`)).status).toBe(404); // чужая сделка
  });

  it("находит переписанную историю и правку денег", async () => {
    t = 1_000_000;
    const { call, pub, store } = await setup();
    const id = await deal(call);
    await call("anna", "POST", "/system/tick");
    expect((await pub("/anchors/verify")).ok).toBe(true);

    const s = await store.load();
    s.deals[id]!.journal![1]!.data = { forged: true };
    const v = await pub("/anchors/verify");
    expect(v.ok).toBe(false);
    expect(typeof v.problems).toBe("number"); // подробности публично не раскрываются
    s.deals[id]!.journal![1]!.data = undefined;

    s.wallets.ivan = (s.wallets.ivan ?? 0) + 5 * R;
    const m = await pub("/anchors/verify");
    expect(m.ok).toBe(false);
    expect(m.money).toBeGreaterThan(0);
  });

  it("ошибка публикации записывается и повторяется, якорь остается", async () => {
    t = 1_000_000;
    const { call, pub, app } = await setup({ fail: true });
    await deal(call);
    await call("anna", "POST", "/system/tick");
    const l = (await pub("/anchors")).anchors;
    expect(l).toHaveLength(1);
    expect(l[0].published).toEqual([]);
    await app.close();
  });

  it("принудительный якорь только у администратора", async () => {
    t = 1_000_000;
    const { call } = await setup();
    expect((await call("anna", "POST", "/system/anchor")).status).toBe(403);
  });
});
