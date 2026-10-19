import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { MemoryStore } from "../src/store";
import { innFromNine } from "../src/inn";

async function setup() {
  let t = 1_700_000_000_000;
  const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => t, seedCatalog: true });
  const tokens: Record<string, string> = {};
  for (const id of ["anna", "ivan", "olga", "admin"]) tokens[id] = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: id } })).json().token;
  const call = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${tokens[who]}` } });
    return { status: r.statusCode, body: r.json() };
  };
  return { call, advance: (ms: number) => (t += ms) };
}

describe("панель администратора", () => {
  it("закрыта для обычных участников", async () => {
    const { call } = await setup();
    for (const url of ["/admin/dashboard", "/admin/transactions", "/admin/disputes", "/admin/verifications", "/admin/users"]) {
      expect((await call("anna", "GET", url)).status).toBe(403);
      expect((await call("admin", "GET", url)).status).toBe(200);
    }
  });

  it("показатели и операции участников", async () => {
    const { call } = await setup();
    await call("anna", "POST", "/wallet/topup", { amount: 500_00 });
    const d = (await call("admin", "GET", "/admin/dashboard")).body;
    expect(d.users.total).toBeGreaterThan(0);
    expect(d.series).toHaveLength(14);
    expect(d.money.topups).toBeGreaterThanOrEqual(500_00);
    expect(d.recent[0].type).toBe("topup");
    const tx = (await call("admin", "GET", "/admin/transactions?type=topup&limit=2")).body;
    expect(tx.items).toHaveLength(2);
    expect(tx.items.every((x: { type: string }) => x.type === "topup")).toBe(true);
    expect(tx.next).not.toBeNull();
    const page2 = (await call("admin", "GET", `/admin/transactions?type=topup&limit=2&before=${tx.next}`)).body;
    expect(page2.items[0].id).toBeLessThan(tx.next);
    const found = (await call("admin", "GET", "/admin/transactions?q=zzzznothing")).body;
    expect(found.items).toHaveLength(0);
  });

  it("заявка на подтверждение: подача, решение, отметка в профиле", async () => {
    const { call } = await setup();
    const body = { legalStatus: "org", inn: innFromNine("770123456"), orgName: "ООО Ромашка" };
    // в личном аккаунте подать нельзя
    await call("anna", "POST", "/me/mode", { kind: "customer" });
    expect((await call("anna", "POST", "/me/verification", body)).status).toBe(403);
    await call("anna", "POST", "/me/mode", { kind: "executor" });
    expect((await call("anna", "POST", "/me/verification", { ...body, inn: "1234567890" })).status).toBe(400);
    expect((await call("anna", "POST", "/me/verification", body)).status).toBe(200);
    expect((await call("anna", "POST", "/me/verification", body)).body.error).toMatch(/рассмотрении/);
    expect((await call("anna", "GET", "/me/verification")).body.status).toBe("pending");

    const q = (await call("admin", "GET", "/admin/verifications")).body;
    expect(q).toHaveLength(1);
    expect(q[0].user.name).toBeTruthy();
    const id = q[0].id;
    expect((await call("admin", "POST", `/admin/verifications/${id}/decision`, { action: "reject" })).status).toBe(400); // без причины
    expect((await call("anna", "POST", `/admin/verifications/${id}/decision`, { action: "approve" })).status).toBe(403);
    expect((await call("admin", "POST", `/admin/verifications/${id}/decision`, { action: "approve" })).status).toBe(200);
    expect((await call("anna", "GET", "/me/verification")).body.status).toBe("approved");
    expect((await call("ivan", "GET", "/users/anna/reviews")).body.user.verified).toBe(true);
    expect((await call("admin", "GET", "/admin/verifications?status=approved")).body).toHaveLength(1);
    expect((await call("admin", "GET", "/admin/dashboard")).body.users.verified).toBeGreaterThanOrEqual(1);
    expect((await call("anna", "GET", "/notifications")).body.items[0].text).toMatch(/подтверждены/);
  });

  it("споры и список участников", async () => {
    const { call } = await setup();
    expect(Array.isArray((await call("admin", "GET", "/admin/disputes")).body)).toBe(true);
    expect(Array.isArray((await call("admin", "GET", "/admin/disputes?status=resolved")).body)).toBe(true);
    const users = (await call("admin", "GET", "/admin/users?q=анна")).body;
    expect(users.length).toBeGreaterThan(0);
    expect(users[0]).toHaveProperty("free");
  });
});
