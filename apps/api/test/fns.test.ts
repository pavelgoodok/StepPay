import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { checkWithFns, similarNames, type FnsCheck } from "../src/fns";
import { MemoryStore } from "../src/store";
import { innFromNine } from "../src/inn";

const NOW = Date.parse("2026-10-13T10:00:00Z");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Подделка fetch: отвечает по адресу и записывает вызовы. */
const fake = (routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const key = Object.keys(routes).find((k) => u.startsWith(k));
    if (!key) throw new Error("нет маршрута " + u);
    return routes[key]!(init);
  }) as typeof fetch;
  return { f, calls };
};

const INN12 = "500100732259";
const ORG = innFromNine("770712345");

describe("сверка с ФНС", () => {
  it("физлицо: реестра нет", async () => {
    const r = await checkWithFns({ legalStatus: "person", inn: INN12 }, NOW);
    expect(r.status).toBe("none");
  });

  it("самозанятый: подтвержден и не подтвержден, запрос с датой и ИНН", async () => {
    const ok = fake({ "https://statusnpd.nalog.ru/": () => json({ status: true, message: "является плательщиком" }) });
    const r = await checkWithFns({ legalStatus: "selfemployed", inn: INN12 }, NOW, ok.f);
    expect(r.status).toBe("match");
    expect(JSON.parse(String(ok.calls[0]!.init!.body))).toEqual({ inn: INN12, requestDate: "2026-10-13" });
    const no = fake({ "https://statusnpd.nalog.ru/": () => json({ status: false, message: "не является плательщиком" }) });
    const r2 = await checkWithFns({ legalStatus: "selfemployed", inn: INN12 }, NOW, no.f);
    expect(r2.status).toBe("mismatch");
    expect(r2.detail).toContain("не является");
  });

  it("сбои сервиса не превращаются в отказ: недоступно", async () => {
    for (const routes of [
      { "https://statusnpd.nalog.ru/": () => json({}, 503) },
      { "https://statusnpd.nalog.ru/": () => new Response("<html>", { status: 200 }) },
      { "https://statusnpd.nalog.ru/": () => json({ foo: 1 }) },
      { "https://statusnpd.nalog.ru/": () => Promise.reject(new Error("net")) },
    ]) {
      const r = await checkWithFns({ legalStatus: "selfemployed", inn: INN12 }, NOW, fake(routes).f);
      expect(r.status).toBe("unavailable");
    }
  });

  const egrulRoutes = (rows: unknown[], captcha = false) => ({
    "https://egrul.nalog.ru/search-result/": () => json({ rows }),
    "https://egrul.nalog.ru/": () => json(captcha ? { captchaRequired: true } : { t: "tok123" }),
  });

  it("организация: найдена и действует, название похоже", async () => {
    const { f, calls } = fake(egrulRoutes([{ i: ORG, n: 'ООО "РОМАШКА ТЕХНОЛОГИИ"', k: "ul" }]));
    const r = await checkWithFns({ legalStatus: "org", inn: ORG, orgName: "Ромашка" }, NOW, f);
    expect(r.status).toBe("match");
    expect(calls[0]!.init!.body!.toString()).toContain(`query=${ORG}`);
    expect(calls[1]!.url).toBe("https://egrul.nalog.ru/search-result/tok123");
  });

  it("организация: не найдена, ликвидирована, не тот вид, чужое название, капча", async () => {
    const run = (rows: unknown[], a: Parameters<typeof checkWithFns>[0], captcha = false) => checkWithFns(a, NOW, fake(egrulRoutes(rows, captcha)).f);
    const org = { legalStatus: "org" as const, inn: ORG, orgName: "Ромашка" };
    expect((await run([], org)).detail).toContain("не найден");
    expect((await run([{ i: ORG, n: "ООО РОМАШКА", k: "ul", e: "01.02.2024" }], org)).detail).toContain("прекращена");
    expect((await run([{ i: ORG, n: "ИП Иванов Иван", k: "fl" }], org)).detail).toContain("индивидуальному предпринимателю");
    expect((await run([{ i: INN12, n: "ООО РОМАШКА", k: "ul" }], { legalStatus: "ip", inn: INN12, orgName: "Иванов Иван" })).detail).toContain("организации");
    expect((await run([{ i: ORG, n: "ООО ВАСИЛЕК", k: "ul" }], org)).detail).toContain("ВАСИЛЕК");
    expect((await run([], org, true)).status).toBe("unavailable");
  });

  it("ИП: сверка по ФИО", async () => {
    const r = await checkWithFns({ legalStatus: "ip", inn: INN12, orgName: "ИП Петров Петр Петрович" }, NOW, fake(egrulRoutes([{ i: INN12, n: "ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ ПЕТРОВ ПЕТР ПЕТРОВИЧ", k: "fl" }])).f);
    expect(r.status).toBe("match");
  });

  it("сравнение названий", () => {
    expect(similarNames('ООО "Ромашка"', "ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ РОМАШКА")).toBe(true);
    expect(similarNames("Ромашка", "Василек")).toBe(false);
    expect(similarNames("", "Василек")).toBe(false);
  });
});

describe("сверка с ФНС в API", () => {
  async function setup(check: FnsCheck) {
    let calls = 0;
    const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => NOW, fnsCheck: async () => { calls++; return check; } });
    const tok: Record<string, string> = {};
    for (const id of ["games", "admin"]) tok[id] = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: id } })).json().token;
    const call = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => {
      const r = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${tok[who]}` } });
      return { status: r.statusCode, body: r.json() };
    };
    return { call, calls: () => calls };
  }

  const project = async (call: Awaited<ReturnType<typeof setup>>["call"]) => {
    expect((await call("games", "POST", "/me/author", { legalStatus: "selfemployed", inn: INN12 })).status).toBe(200);
    const pr = (await call("games", "POST", "/projects", { kind: "crowdfunding", title: "Новая игра" })).body;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
    const up = (await call("games", "POST", "/uploads", { dataUrl: `data:image/png;base64,${png.toString("base64")}` })).body as { url: string };
    const pdf = (await call("games", "POST", "/uploads", { dataUrl: `data:application/pdf;base64,${Buffer.from("%PDF-1.4 test").toString("base64")}`, private: true })).body as { url: string };
    await call("games", "POST", `/projects/${pr.id}/update`, { title: "Новая игра", summary: "Игра для компании на вечер с понятными правилами", category: "Игры", description: "Выпускаем настольную игру для компании: правила проверены на десятках партий, собираем деньги на печать тиража и коробок. Каждый этап принимают спонсоры.", stages: [{ title: "Макет", amount: 10_000_000 }], docs: [{ id: "ph1", name: "Фото", url: up.url, kind: "photo" }, { id: "d1", name: "Смета.pdf", url: pdf.url, kind: "doc" }] });
    return pr.id as string;
  };

  it("результат сохраняется в анкете и виден администратору", async () => {
    const { call } = await setup({ status: "mismatch", checkedAt: NOW, source: "ФНС, статус плательщика НПД", detail: "ФНС не подтверждает статус самозанятого" });
    const id = await project(call);
    const author = (await call("games", "GET", "/me/author")).body;
    expect(author.fns.status).toBe("mismatch");
    expect((await call("admin", "GET", `/projects/${id}`)).body.author.fns.status).toBe("mismatch");
  });

  it("расхождение блокирует одобрение, пока администратор не подтвердит, что учел его; это пишется в журнал", async () => {
    const { call } = await setup({ status: "mismatch", checkedAt: NOW, source: "ФНС", detail: "ИНН не найден" });
    const id = await project(call);
    const sub = await call("games", "POST", `/projects/${id}/submit`, {});
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const blocked = await call("admin", "POST", `/admin/projects/${id}/decision`, { action: "approve" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toContain("ФНС");
    expect((await call("admin", "POST", `/admin/projects/${id}/decision`, { action: "approve", acknowledgeFns: true })).status).toBe(200);
    expect((await call("admin", "GET", "/admin/audit")).body.some((e: { action: string }) => e.action.includes("вопреки"))).toBe(true);
  });

  it("повторная сверка по кнопке: только администратор, результат обновляется", async () => {
    const { call, calls } = await setup({ status: "match", checkedAt: NOW, source: "ФНС", detail: "Найден в реестре" });
    const id = await project(call);
    expect((await call("games", "POST", `/admin/projects/${id}/fns`)).status).toBe(403);
    const before = calls();
    const r = await call("admin", "POST", `/admin/projects/${id}/fns`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe("match");
    expect(calls()).toBe(before + 1);
  });

  it("в демо сверка отключена по умолчанию", async () => {
    const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => NOW });
    const tok = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: "games" } })).json().token;
    const r = await app.inject({ method: "POST", url: "/me/author", payload: { legalStatus: "selfemployed", inn: INN12 }, headers: { authorization: `Bearer ${tok}` } });
    expect(r.json().fns.status).toBe("none");
  });
});
