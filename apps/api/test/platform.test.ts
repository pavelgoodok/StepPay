import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { MemoryStore } from "../src/store";
import { createHash } from "node:crypto";
import { validInn, innFromNine } from "../src/inn";

const R = 100;

async function setup() {
  let t = 1_000_000;
  const app = await buildApp({ store: new MemoryStore(), secret: "s", now: () => t });
  const tokens: Record<string, string> = {};
  for (const id of ["anna", "ivan", "olga", "fond", "admin", "expert", "games", "tsj"]) {
    tokens[id] = (await app.inject({ method: "POST", url: "/auth/demo", payload: { userId: id } })).json().token;
  }
  const call = async (who: string, method: "GET" | "POST", url: string, payload?: unknown) => {
    const r = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${tokens[who]}` } });
    return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? r.json() : r.body };
  };
  return { app, call, tokens };
}

describe("ИНН", () => {
  it("проверяет контрольную сумму", () => {
    expect(validInn(innFromNine("123456789"))).toBe(true);
    expect(validInn("1234567890")).toBe(false);
    expect(validInn("12345")).toBe(false);
  });
});

describe("проекты с проверкой", () => {
  it("автор подает, администратор возвращает на доработку, затем одобряет; создается сбор", async () => {
    const { call, tokens, app } = await setup();
    const up = async (mime: string, priv: boolean) => {
      const r = await app.inject({
        method: "POST",
        url: "/uploads",
        headers: { authorization: `Bearer ${tokens.olga}` },
        payload: { dataUrl: `data:${mime};base64,${Buffer.from("%PDF-1.4 test").toString("base64")}`, private: priv },
      });
      return r;
    };
    expect((await up("application/pdf", false)).statusCode).toBe(400); // документы только приватные
    const doc = (await up("application/pdf", true)).json();
    expect(doc.url).toMatch(/^\/uploads\//);
    // приватный файл: автору и администратору можно, чужому нельзя
    expect((await call("olga", "GET", doc.url)).status).toBe(200);
    expect((await call("admin", "GET", doc.url)).status).toBe(200);
    expect((await call("anna", "GET", doc.url)).status).toBe(403);

    const p = (await call("olga", "POST", "/projects", { kind: "crowdfunding", title: "Свой альбом", category: "Музыка и творчество" })).body;
    expect(p.status).toBe("draft");
    expect((await call("olga", "POST", `/projects/${p.id}/submit`)).status).toBe(400); // нет анкеты
    expect((await call("olga", "POST", "/me/author", { legalStatus: "ip", inn: "1234567890" })).status).toBe(400); // плохая контрольная сумма
    expect((await call("olga", "POST", "/me/author", { legalStatus: "selfemployed", inn: innFromNine("987654321").slice(0, 9) + "0" })).status).toBeLessThan(500);
    const inn12 = innFromNine("123456789");
    expect((await call("olga", "POST", "/me/author", { legalStatus: "org", inn: inn12, orgName: "ООО «Альбом»" })).status).toBe(200);

    expect((await call("olga", "POST", `/projects/${p.id}/submit`)).status).toBe(400); // не заполнен
    await call("olga", "POST", `/projects/${p.id}/update`, {
      summary: "Записываем и выпускаем первый альбом группы",
      description: "Мы группа из трех человек. Записываем десять песен в студии, делаем обложку и выпускаем тираж винила для тех, кто нас слушает. Деньги пойдут на студию и печать.",
      stages: [{ title: "Запись", amount: 100_000 * R, criteria: ["Десять треков"] }, { title: "Тираж", amount: 50_000 * R, criteria: [] }],
      docs: [{ id: "ph", name: "Фото группы", url: "/uploads/demo-tile-photo-0001", kind: "photo" }, { id: "d1", name: "Смета", url: doc.url, kind: "doc" }],
    });
    expect((await call("olga", "POST", `/projects/${p.id}/submit`)).status).toBe(200);
    expect((await call("olga", "POST", `/projects/${p.id}/update`, { title: "Иначе" })).status).toBe(400); // на проверке не правится

    // не администратор
    expect((await call("anna", "GET", "/admin/projects")).status).toBe(403);
    expect((await call("anna", "POST", `/admin/projects/${p.id}/decision`, { action: "approve" })).status).toBe(403);
    const queue = (await call("admin", "GET", "/admin/projects?status=review")).body;
    expect(queue.map((x: { id: string }) => x.id)).toContain(p.id);
    // отказ без причины нельзя
    expect((await call("admin", "POST", `/admin/projects/${p.id}/decision`, { action: "changes" })).status).toBe(400);
    expect((await call("admin", "POST", `/admin/projects/${p.id}/decision`, { action: "changes", comment: "Добавьте ссылки на прошлые работы" })).status).toBe(200);
    const back = (await call("olga", "GET", `/projects/${p.id}`)).body;
    expect(back.status).toBe("changes");
    expect(JSON.stringify(back.history)).toContain("Добавьте ссылки");
    expect((await call("olga", "POST", `/projects/${p.id}/submit`)).status).toBe(200);
    // до одобрения проекта нет в каталоге
    expect((await call("anna", "GET", "/projects")).body.map((x: { id: string }) => x.id)).not.toContain(p.id);
    const ok = await call("admin", "POST", `/admin/projects/${p.id}/decision`, { action: "approve" });
    expect(ok.status).toBe(200);
    const cat = (await call("anna", "GET", "/projects")).body.find((x: { id: string }) => x.id === p.id);
    expect(cat).toBeTruthy();
    const full = (await call("anna", "GET", `/projects/${p.id}`)).body;
    expect(full.dealId).toBeTruthy();
    // сбор открыт: спонсор вносит
    expect((await call("anna", "POST", `/deals/${full.dealId}/fund`, { amount: 10_000 * R })).status).toBe(200);
    // сбор собран полностью, но работа ждет подписи автора
    expect((await call("anna", "POST", `/deals/${full.dealId}/fund`, { amount: 140_000 * R })).status).toBe(200);
    let cd = (await call("anna", "GET", `/deals/${full.dealId}`)).body;
    expect(cd.status).toBe("funding");
    expect(cd.signatureStatus).toMatchObject({ required: ["olga"], signed: [], complete: false });
    expect((await call("anna", "POST", `/deals/${full.dealId}/sign`)).status).toBe(400); // спонсор не сторона контракта
    expect((await call("olga", "POST", `/deals/${full.dealId}/sign`)).status).toBe(200);
    cd = (await call("anna", "GET", `/deals/${full.dealId}`)).body;
    expect(cd.status).toBe("active");
    // чужому документов не видно
    expect(full.docs?.filter?.((d: { kind: string }) => d.kind === "doc") ?? []).toHaveLength(0);
  });

  it("грант: финансирует только проверенный грантодатель, всю сумму сразу", async () => {
    const { call, app } = await setup();
    await app.inject({ method: "POST", url: "/demo/reset" });
    const grant = (await call("anna", "GET", "/projects?kind=grant")).body.find((x: { dealId?: string }) => !x.dealId);
    expect(grant).toBeTruthy();
    expect((await call("anna", "POST", `/projects/${grant.id}/grant`)).status).toBe(403);
    const r = await call("fond", "POST", `/projects/${grant.id}/grant`);
    expect(r.status).toBe(200);
    expect((await call("fond", "POST", `/projects/${grant.id}/grant`)).status).toBe(400); // повторно нельзя
    let d = (await call("fond", "GET", `/deals/${r.body.dealId}`)).body;
    expect(d.status).toBe("funding"); // деньги зарезервированы, ждем подпись автора
    expect(d.signatureStatus).toMatchObject({ signed: ["fond"], complete: false });
    expect((await call("fond", "POST", `/deals/${r.body.dealId}/sign`)).status).toBe(400); // уже подписал
    await call("tsj", "POST", `/deals/${r.body.dealId}/sign`);
    d = (await call("fond", "GET", `/deals/${r.body.dealId}`)).body;
    expect(d.status).toBe("active");
  });
});

describe("услуги и согласование задачи", () => {
  it("карточка, чат, регистрация задачи, условия, резерв", async () => {
    const { call } = await setup();
    const svc = (await call("ivan", "POST", "/services", { title: "Ремонт квартир", category: "Ремонт и строительство", description: "Делаю ремонт под ключ, работаю один, сроки обсуждаем.", photos: [] })).body;
    expect((await call("anna", "GET", "/services")).body.map((s: { id: string }) => s.id)).toContain(svc.id);
    expect((await call("ivan", "POST", `/services/${svc.id}/chat`, {})).status).toBe(400); // нельзя писать самому себе
    const th = (await call("anna", "POST", `/services/${svc.id}/chat`, { text: "Здравствуйте, нужен ремонт" })).body;
    expect((await call("anna", "POST", `/services/${svc.id}/chat`, {})).body.id).toBe(th.id); // тот же чат
    expect((await call("olga", "GET", `/chats/${th.id}`)).status).toBeGreaterThanOrEqual(400); // чужой чат закрыт
    await call("ivan", "POST", `/chats/${th.id}/messages`, { text: "Добрый день" });
    // задачу регистрирует только исполнитель
    expect((await call("anna", "POST", `/chats/${th.id}/task`, { title: "Ремонт" })).status).toBeGreaterThanOrEqual(400);
    const task = (await call("ivan", "POST", `/chats/${th.id}/task`, { title: "Ремонт ванной", description: "4 кв. м" })).body;
    const id = task.id ?? task.dealId;
    expect((await call("ivan", "GET", `/deals/${id}`)).body.status).toBe("draft");
    // пока нет условий, резерв невозможен
    expect((await call("anna", "POST", `/deals/${id}/fund`, {})).status).toBe(400);
    // условия может править только исполнитель
    const stages = [{ title: "Плитка", amount: 100_000 * R, criteria: ["Швы ровные"] }, { title: "Сантехника", amount: 50_000 * R, criteria: [] }];
    expect((await call("anna", "POST", `/deals/${id}/terms`, { stages })).status).toBe(400);
    expect((await call("ivan", "POST", `/deals/${id}/terms`, { stages })).status).toBe(200);
    expect((await call("ivan", "POST", `/deals/${id}/propose`)).status).toBe(200);
    expect((await call("anna", "POST", `/deals/${id}/fund`, {})).status).toBe(200);
    const after = (await call("ivan", "GET", `/deals/${id}`)).body;
    expect(after.status).toBe("active");
    const chat = (await call("anna", "GET", `/chats/${th.id}`)).body;
    expect(chat.messages.some((m: { kind: string }) => m.kind === "system")).toBe(true);
  });
});

describe("контракт сделки в API", () => {
  it("хеш фиксируется при отправке условий и проверяется независимо", async () => {
    const { call } = await setup();
    const svc = (await call("ivan", "POST", "/services", { title: "Ремонт квартир", category: "Ремонт и строительство", description: "Делаю ремонт под ключ, работаю один.", photos: [] })).body;
    const th = (await call("anna", "POST", `/services/${svc.id}/chat`, { text: "Здравствуйте" })).body;
    const id = (await call("ivan", "POST", `/chats/${th.id}/task`, { title: "Ремонт ванной" })).body.dealId;
    expect((await call("anna", "GET", `/deals/${id}/contract`)).body.contract).toBeNull(); // в согласовании контракта нет
    await call("ivan", "POST", `/deals/${id}/terms`, { stages: [{ title: "Плитка", amount: 100_000 * R, criteria: ["Швы ровные"] }] });
    await call("ivan", "POST", `/deals/${id}/propose`);
    const c = (await call("anna", "GET", `/deals/${id}/contract`)).body;
    expect(c.contract.hash).toHaveLength(64);
    expect(c.check).toMatchObject({ sealed: true, ok: true });
    expect(createHash("sha256").update(c.canonical, "utf8").digest("hex")).toBe(c.contract.hash); // проверка без нашего кода
    const d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.contractCheck.ok).toBe(true);
    expect(d.terms.stages[0].title).toBe("Плитка");
    // журнал: фиксация условий записана, цепочка цела
    expect(d.journalCheck).toMatchObject({ ok: true, count: 3 }); // создание, условия, подпись исполнителя
    await call("anna", "POST", `/deals/${id}/fund`, {});
    const j = (await call("anna", "GET", `/deals/${id}/journal`)).body;
    expect(j.entries.map((e: { type: string }) => e.type)).toEqual(["created", "terms_sealed", "signed", "signed", "reserved", "activated"]);
    expect(j.entries[1].data.contract).toBe(c.contract.hash);
    expect(j.check).toMatchObject({ ok: true, count: 6, contractMatches: true });
  });
});

describe("подписи сторон в API", () => {
  it("исполнитель подписывает при отправке условий, заказчик при резерве; работа начинается после обеих подписей", async () => {
    const { call } = await setup();
    const svc = (await call("ivan", "POST", "/services", { title: "Ремонт квартир", category: "Ремонт и строительство", description: "Делаю ремонт под ключ, работаю один.", photos: [] })).body;
    const th = (await call("anna", "POST", `/services/${svc.id}/chat`, { text: "Здравствуйте" })).body;
    const id = (await call("ivan", "POST", `/chats/${th.id}/task`, { title: "Ремонт ванной" })).body.dealId;
    expect((await call("ivan", "POST", `/deals/${id}/sign`)).status).toBe(400); // контракта еще нет
    await call("ivan", "POST", `/deals/${id}/terms`, { stages: [{ title: "Плитка", amount: 100_000 * R }] });
    await call("ivan", "POST", `/deals/${id}/propose`);
    let d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.signatureStatus).toMatchObject({ required: ["ivan", "anna"], signed: ["ivan"], complete: false, valid: { ivan: true } });
    expect((await call("olga", "POST", `/deals/${id}/sign`)).status).toBe(400); // чужой
    // резерв подписывает за заказчика и запускает работу
    expect((await call("anna", "POST", `/deals/${id}/fund`, {})).status).toBe(200);
    d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.status).toBe("active");
    expect(d.signatureStatus).toMatchObject({ complete: true, valid: { ivan: true, anna: true } });
    expect(d.summary.signatures).toMatchObject({ complete: true });
  });
});

describe("прогон сделки на контракте в сети", () => {
  it("администратор прикрепляет отчет, остальные не могут, данные проверяются", async () => {
    const { call } = await setup();
    const svc = (await call("ivan", "POST", "/services", { title: "Ремонт квартир", category: "Ремонт и строительство", description: "Делаю ремонт под ключ, работаю один.", photos: [] })).body;
    const th = (await call("anna", "POST", `/services/${svc.id}/chat`, { text: "Здравствуйте" })).body;
    const id = (await call("ivan", "POST", `/chats/${th.id}/task`, { title: "Ремонт ванной" })).body.dealId;
    const report = { network: "Sepolia", chainId: 11155111, contract: "0x" + "ab".repeat(20), dealId: 1, explorer: "https://sepolia.etherscan.io/", txs: [{ label: "Резерв", hash: "0x" + "cd".repeat(32), at: 1 }] };
    expect((await call("anna", "POST", `/deals/${id}/chain`, report)).status).toBe(403);
    expect((await call("admin", "POST", `/deals/${id}/chain`, { ...report, contract: "0x1" })).status).toBe(400);
    expect((await call("admin", "POST", `/deals/${id}/chain`, { ...report, explorer: "http://evil" })).status).toBe(400);
    expect((await call("admin", "POST", `/deals/${id}/chain`, report)).status).toBe(200);
    const d = (await call("anna", "GET", `/deals/${id}`)).body;
    expect(d.chain).toMatchObject({ network: "Sepolia", explorer: "https://sepolia.etherscan.io", dealId: 1 });
  });
});
