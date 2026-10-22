import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { MemoryStore } from "../src/store";

async function setup(opts: { adminRequireKey?: boolean; passkeys?: boolean } = { adminRequireKey: true }) {
  const app = await buildApp({ store: new MemoryStore(), secret: "s", ...opts });
  const tokens: Record<string, string> = {};
  for (const id of ["anna", "admin"]) tokens[id] = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: id } })).json().token;
  const call = async (token: string, method: "GET" | "POST", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
    return { status: r.statusCode, body: r.json() };
  };
  return { app, tokens, call };
}

describe("вход администратора по коду доступа", () => {
  it("без кода номер администратора работает как обычный участник", async () => {
    const { tokens, call } = await setup();
    const t = tokens.admin!;
    const me = await call(t, "GET", "/me");
    expect(me.body.user.role).toBe("user");
    expect(me.body.adminEntry).toEqual({ codeSet: false });
    expect((await call(t, "GET", "/deals")).status).toBe(200);
    expect((await call(t, "GET", "/admin/dashboard")).status).toBe(403);
    expect((await call(t, "GET", "/admin/projects")).status).toBe(403);
  });

  it("код создается один раз, по нему открываются права администратора", async () => {
    const { tokens, call } = await setup();
    const t = tokens.admin!;
    const made = await call(t, "POST", "/auth/admin/code", {});
    expect(made.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect((await call(t, "POST", "/auth/admin/code", {})).status).toBe(409);
    expect((await call(t, "GET", "/me")).body.adminEntry).toEqual({ codeSet: true });
    const ok = await call(t, "POST", "/auth/admin/enter", { code: made.body.code.toLowerCase().replace("-", " ") });
    expect(ok.status).toBe(200);
    const full = ok.body.token;
    expect(full).toMatch(/^p2\./);
    expect((await call(full, "GET", "/admin/dashboard")).status).toBe(200);
    const me = await call(full, "GET", "/me");
    expect(me.body.user.role).toBe("admin");
    expect(me.body.adminEntry).toBeUndefined();
    expect((await call(full, "GET", "/admin/audit")).body.some((x: { action: string }) => x.action.includes("по коду доступа"))).toBe(true);
  });

  it("неверный код отклоняется, после пяти попыток вход блокируется", async () => {
    const { tokens, call } = await setup();
    const t = tokens.admin!;
    const { code } = (await call(t, "POST", "/auth/admin/code", {})).body;
    for (let i = 0; i < 5; i++) expect((await call(t, "POST", "/auth/admin/enter", { code: "AAAA-AAAA" })).status).toBe(401);
    expect((await call(t, "POST", "/auth/admin/enter", { code })).status).toBe(429);
  });

  it("обычному номеру вход администратора недоступен", async () => {
    const { tokens, call } = await setup();
    expect((await call(tokens.anna!, "POST", "/auth/admin/code", {})).status).toBe(403);
    expect((await call(tokens.anna!, "POST", "/auth/admin/enter", { code: "AAAA-AAAA" })).status).toBe(403);
    expect((await call(tokens.anna!, "GET", "/me")).body.adminEntry).toBeUndefined();
  });

  it("в демо без требования администратор работает сразу", async () => {
    const { tokens, call } = await setup({});
    expect((await call(tokens.admin!, "GET", "/admin/dashboard")).status).toBe(200);
    expect((await call(tokens.admin!, "GET", "/me")).body.user.role).toBe("admin");
  });

  it("passkey по умолчанию выключены", async () => {
    const { tokens, call, app } = await setup({});
    expect((await app.inject({ method: "POST", url: "/auth/passkey/challenge", payload: {} })).statusCode).toBe(404);
    expect((await call(tokens.anna!, "POST", "/me/passkeys", {})).status).toBe(404);
  });
});
