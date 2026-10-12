import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  EngineError,
  approveStage,
  cancelDeal,
  createDeal,
  createState,
  freeBalance,
  fund,
  openDispute,
  replyDispute,
  updateTerms,
  proposeDeal,
  reopenDeal,
  rejectStage,
  reservedBalance,
  resolveDispute,
  splitProRata,
  submitStage,
  tick,
  topUp,
  voteStage,
  type State,
  CONTRACT_VERSION,
  canonicalJson,
  contractHash,
  contractTerms,
  sha256Hex,
  verifyContract,
  verifyJournal,
  verifyEntries,
  genesisHash,
  signContract,
  signatureStatus,
  linkChain,
  expireFunding,
  expireStage,
  expireDispute,
} from "../src";

const R = 100; // рубль в копейках
const T0 = 1_000_000;

/** Деньги не создаются и не пропадают: свободные + резервы = все пополненное. */
function totalMoney(s: State) {
  const free = Object.values(s.wallets).reduce((a, b) => a + b, 0);
  const reserved = Object.values(s.deals).flatMap((d) => Object.values(d.reserves)).reduce((a, b) => a + b, 0);
  return free + reserved;
}
const toppedUp = (s: State) => s.ledger.filter((l) => l.type === "topup").reduce((a, l) => a + l.amount, 0);

const bathroom = (s: State) =>
  createDeal(s, {
    id: "d1",
    mode: "own",
    title: "Ремонт ванной",
    executorId: "ivan",
    ownerId: "anna",
    arbiterId: "expert",
    stages: [
      { title: "Демонтаж", amount: 30_000 * R },
      { title: "Электрика", amount: 60_000 * R },
      { title: "Плитка", amount: 120_000 * R },
      { title: "Сантехника", amount: 90_000 * R },
    ],
    at: T0,
  });

describe("splitProRata", () => {
  it("сумма частей равна исходной", () => {
    const r = splitProRata(100, { a: 1, b: 1, c: 1 });
    expect(Object.values(r).reduce((x, y) => x + y, 0)).toBe(100);
  });
});

describe("режим «Свой проект» (демо из презентации)", () => {
  it("резерв → сдача → приемка → выплата", () => {
    let s = createState();
    s = topUp(s, "anna", 300_000 * R, T0);
    s = bathroom(s);
    s = fund(s, "d1", "anna", 300_000 * R, T0);
    expect(freeBalance(s, "anna")).toBe(0);
    expect(reservedBalance(s, "anna")).toBe(300_000 * R);
    expect(s.deals.d1!.stages[0]!.status).toBe("active");

    s = submitStage(s, "d1", "s1", "ivan", { photos: ["a.jpg"] }, T0 + 1);
    s = approveStage(s, "d1", "s1", "anna", T0 + 2);
    expect(freeBalance(s, "ivan")).toBe(30_000 * R);
    expect(s.deals.d1!.stages[1]!.status).toBe("active");

    for (const id of ["s2", "s3", "s4"]) {
      s = submitStage(s, "d1", id, "ivan", {}, T0 + 3);
      s = approveStage(s, "d1", id, "anna", T0 + 4);
    }
    expect(s.deals.d1!.status).toBe("completed");
    expect(freeBalance(s, "ivan")).toBe(300_000 * R);
    expect(reservedBalance(s, "anna")).toBe(0);
    expect(totalMoney(s)).toBe(toppedUp(s));
  });

  it("автоприемка через 3 дня без ответа", () => {
    let s = createState();
    s = topUp(s, "anna", 300_000 * R, T0);
    s = bathroom(s);
    s = fund(s, "d1", "anna", 300_000 * R, T0);
    s = submitStage(s, "d1", "s1", "ivan", {}, T0);
    s = tick(s, T0 + 2 * DAY_MS);
    expect(s.deals.d1!.stages[0]!.status).toBe("submitted");
    s = tick(s, T0 + 3 * DAY_MS);
    expect(s.deals.d1!.stages[0]!.status).toBe("accepted");
    expect(freeBalance(s, "ivan")).toBe(30_000 * R);
  });

  it("отказ только с причиной, спор замораживает деньги, приемщик решает", () => {
    let s = createState();
    s = topUp(s, "anna", 300_000 * R, T0);
    s = bathroom(s);
    s = fund(s, "d1", "anna", 300_000 * R, T0);
    s = submitStage(s, "d1", "s1", "ivan", {}, T0);
    expect(() => rejectStage(s, "d1", "s1", "anna", "  ", T0)).toThrow(EngineError);
    s = rejectStage(s, "d1", "s1", "anna", "Не вывезен мусор", T0);
    expect(s.deals.d1!.stages[0]!.status).toBe("disputed");
    expect(freeBalance(s, "ivan")).toBe(0);
    // автоприемка спор не обходит
    s = tick(s, T0 + 10 * DAY_MS);
    expect(s.deals.d1!.stages[0]!.status).toBe("disputed");

    const pay = resolveDispute(s, "d1", "s1", "expert", "pay", T0);
    expect(freeBalance(pay, "ivan")).toBe(30_000 * R);
    const refund = resolveDispute(s, "d1", "s1", "expert", "refund", T0);
    expect(freeBalance(refund, "anna")).toBe(300_000 * R);
    expect(refund.deals.d1!.status).toBe("cancelled");
    expect(totalMoney(refund)).toBe(toppedUp(refund));
  });

  it("исполнитель тоже может открыть спор, чужой - нет", () => {
    let s = createState();
    s = topUp(s, "anna", 300_000 * R, T0);
    s = bathroom(s);
    s = fund(s, "d1", "anna", 300_000 * R, T0);
    s = submitStage(s, "d1", "s1", "ivan", {}, T0);
    expect(() => openDispute(s, "d1", "s1", "stranger", "x", T0)).toThrow(EngineError);
    expect(openDispute(s, "d1", "s1", "ivan", "Заказчик придирается", T0).deals.d1!.stages[0]!.status).toBe("disputed");
  });

  it("отмена возвращает резерв; нельзя резервировать без денег; нельзя принять чужой этап", () => {
    let s = createState();
    s = bathroom(s);
    expect(() => fund(s, "d1", "anna", 300_000 * R, T0)).toThrow(/Недостаточно/);
    s = topUp(s, "anna", 300_000 * R, T0);
    s = fund(s, "d1", "anna", 300_000 * R, T0);
    s = submitStage(s, "d1", "s1", "ivan", {}, T0);
    expect(() => approveStage(s, "d1", "s1", "ivan", T0)).toThrow(EngineError);
    s = approveStage(s, "d1", "s1", "anna", T0);
    s = cancelDeal(s, "d1", "anna", T0);
    expect(freeBalance(s, "anna")).toBe(270_000 * R);
    expect(freeBalance(s, "ivan")).toBe(30_000 * R);
  });

  it("комиссия за сделку уходит платформе", () => {
    let s = createState();
    s = topUp(s, "anna", 300_000 * R, T0);
    s = createDeal(s, {
      id: "d2", mode: "own", title: "Сайт", executorId: "ivan", ownerId: "anna",
      stages: [{ title: "Дизайн", amount: 100_000 * R }, { title: "Верстка", amount: 200_000 * R }],
      feeBps: 100, at: T0,
    });
    s = fund(s, "d2", "anna", 300_000 * R, T0);
    s = submitStage(s, "d2", "s1", "ivan", {}, T0);
    s = approveStage(s, "d2", "s1", "anna", T0);
    expect(freeBalance(s, "ivan")).toBe(99_000 * R);
    expect(freeBalance(s, "platform")).toBe(1_000 * R);
    expect(totalMoney(s)).toBe(toppedUp(s));
  });
});

describe("режим «Краудфандинг»", () => {
  const setup = () => {
    let s = createState();
    for (const u of ["a", "b", "c"]) s = topUp(s, u, 100_000 * R, T0);
    s = createDeal(s, {
      id: "c1", mode: "crowdfunding", title: "Настольная игра", executorId: "author",
      stages: [{ title: "Макет", amount: 100_000 * R }, { title: "Тираж", amount: 200_000 * R }],
      at: T0,
    });
    s = fund(s, "c1", "a", 100_000 * R, T0);
    s = fund(s, "c1", "b", 100_000 * R, T0);
    return s;
  };

  it("стартует, только когда собрана вся сумма; лишнего не принимает", () => {
    let s = setup();
    expect(s.deals.c1!.status).toBe("funding");
    expect(() => fund(s, "c1", "c", 100_001 * R, T0)).toThrow(EngineError);
    s = fund(s, "c1", "c", 100_000 * R, T0);
    expect(s.deals.c1!.status).toBe("active");
  });

  it("этап принимается большинством по весу взносов, выплата списывается пропорционально", () => {
    let s = setup();
    s = fund(s, "c1", "c", 100_000 * R, T0);
    s = submitStage(s, "c1", "s1", "author", {}, T0);
    s = voteStage(s, "c1", "s1", "a", "accept", T0);
    expect(s.deals.c1!.stages[0]!.status).toBe("submitted");
    s = voteStage(s, "c1", "s1", "b", "accept", T0);
    expect(s.deals.c1!.stages[0]!.status).toBe("accepted");
    expect(freeBalance(s, "author")).toBe(100_000 * R);
    expect(totalMoney(s)).toBe(toppedUp(s));
  });

  it("провал этапа - остаток возвращается спонсорам пропорционально (демо)", () => {
    let s = setup();
    s = fund(s, "c1", "c", 100_000 * R, T0);
    s = submitStage(s, "c1", "s1", "author", {}, T0);
    s = voteStage(s, "c1", "s1", "a", "accept", T0);
    s = voteStage(s, "c1", "s1", "b", "accept", T0);
    s = submitStage(s, "c1", "s2", "author", {}, T0);
    s = voteStage(s, "c1", "s2", "a", "reject", T0);
    s = voteStage(s, "c1", "s2", "b", "reject", T0);
    expect(s.deals.c1!.status).toBe("cancelled");
    // у каждого спонсора ушла треть первого этапа (100 000 / 3 ≈ 33 333,33 ₽), остальное вернулось
    const back = ["a", "b", "c"].map((u) => freeBalance(s, u));
    expect(back.reduce((x, y) => x + y, 0)).toBe(200_000 * R);
    expect(totalMoney(s)).toBe(toppedUp(s));
  });

  it("голосовать может только спонсор; автоприемка при молчании", () => {
    let s = setup();
    s = fund(s, "c1", "c", 100_000 * R, T0);
    s = submitStage(s, "c1", "s1", "author", {}, T0);
    expect(() => voteStage(s, "c1", "s1", "stranger", "accept", T0)).toThrow(EngineError);
    s = tick(s, T0 + 3 * DAY_MS);
    expect(s.deals.c1!.stages[0]!.status).toBe("accepted");
  });

  it("сбор не завершен - автор отменяет, спонсоры получают взносы", () => {
    let s = setup();
    s = cancelDeal(s, "c1", "author", T0);
    expect(freeBalance(s, "a")).toBe(100_000 * R);
    expect(freeBalance(s, "b")).toBe(100_000 * R);
  });
});

describe("режим «Грант»", () => {
  it("отказ грантодателя - деньги не уходят, остаток возвращается; автоприемки нет", () => {
    let s = createState();
    s = topUp(s, "fund", 500_000 * R, T0);
    s = createDeal(s, {
      id: "g1", mode: "grant", title: "Культура районов", executorId: "ngo", ownerId: "fund",
      stages: [{ title: "Закупка", amount: 200_000 * R }, { title: "Фестиваль", amount: 300_000 * R }],
      at: T0,
    });
    s = fund(s, "g1", "fund", 500_000 * R, T0);
    s = submitStage(s, "g1", "s1", "ngo", {}, T0);
    s = tick(s, T0 + 30 * DAY_MS);
    expect(s.deals.g1!.stages[0]!.status).toBe("submitted");
    s = rejectStage(s, "g1", "s1", "fund", "Нет отчетных документов", T0);
    expect(freeBalance(s, "ngo")).toBe(0);
    expect(freeBalance(s, "fund")).toBe(500_000 * R);
    expect(s.deals.g1!.status).toBe("cancelled");
  });
});

describe("переписка по спору и причина закрытия", () => {
  const disputed = () => {
    let s = createState();
    s = topUp(s, "anna", 300_000 * R, T0);
    s = bathroom(s);
    s = fund(s, "d1", "anna", 300_000 * R, T0);
    s = submitStage(s, "d1", "s1", "ivan", {}, T0);
    return rejectStage(s, "d1", "s1", "anna", "Не вывезен мусор", T0 + 1);
  };

  it("причина отказа становится первой репликой; стороны и приемщик отвечают, чужие - нет", () => {
    let s = disputed();
    expect(s.deals.d1!.stages[0]!.messages).toEqual([{ by: "anna", text: "Не вывезен мусор", at: T0 + 1 }]);
    s = replyDispute(s, "d1", "s1", "ivan", "Вывезли, вот фото", ["/uploads/a"], T0 + 2);
    s = replyDispute(s, "d1", "s1", "expert", "Уточните объем", [], T0 + 3);
    expect(s.deals.d1!.stages[0]!.messages).toHaveLength(3);
    expect(s.deals.d1!.stages[0]!.messages![1]!.photos).toEqual(["/uploads/a"]);
    expect(() => replyDispute(s, "d1", "s1", "stranger", "я тоже", [], T0)).toThrow(EngineError);
    expect(() => replyDispute(s, "d1", "s1", "ivan", "  ", [], T0)).toThrow(EngineError);
  });

  it("решение приемщика сохраняет комментарий и автора решения", () => {
    const s = resolveDispute(disputed(), "d1", "s1", "expert", "pay", T0 + 5, "  Фото подтверждают  ");
    expect(s.deals.d1!.stages[0]!.resolution).toEqual({ by: "arbiter", decision: "accepted", comment: "Фото подтверждают", at: T0 + 5 });
  });

  it("фиксируется, кто принял этап: заказчик или автоприемка", () => {
    let s = createState();
    s = topUp(s, "anna", 300_000 * R, T0);
    s = bathroom(s);
    s = fund(s, "d1", "anna", 300_000 * R, T0);
    s = submitStage(s, "d1", "s1", "ivan", {}, T0);
    s = approveStage(s, "d1", "s1", "anna", T0);
    s = submitStage(s, "d1", "s2", "ivan", {}, T0);
    s = tick(s, T0 + 3 * DAY_MS);
    expect(s.deals.d1!.stages[0]!.resolution?.by).toBe("owner");
    expect(s.deals.d1!.stages[1]!.resolution?.by).toBe("auto");
  });

  it("реплика возможна только по этапу в споре", () => {
    let s = createState();
    s = topUp(s, "anna", 300_000 * R, T0);
    s = bathroom(s);
    s = fund(s, "d1", "anna", 300_000 * R, T0);
    expect(() => replyDispute(s, "d1", "s1", "anna", "x", [], T0)).toThrow(/не в споре/);
  });
});

describe("согласование условий (услуги)", () => {
  const draft = () => {
    let s = createState();
    s = topUp(s, "anna", 100_000 * R, T0);
    return createDeal(s, { id: "t1", mode: "own", title: "Задача", executorId: "ivan", ownerId: "anna", status: "draft", meta: { serviceId: "svc1", chatId: "c1", description: "Описание" }, stages: [{ title: "Черновой этап", amount: 1 * R }], at: T0 });
  };

  it("в черновике деньги принимать нельзя, условия правит только исполнитель", () => {
    let s = draft();
    expect(s.deals.t1!.status).toBe("draft");
    expect(() => fund(s, "t1", "anna", 1 * R, T0)).toThrow(/не отправил условия/);
    expect(() => updateTerms(s, "t1", "anna", { title: "Мое" })).toThrow(EngineError);
    s = updateTerms(s, "t1", "ivan", { title: "Ремонт ванной", description: "4 м2", stages: [{ title: "Плитка", amount: 70_000 * R }, { title: "Сантехника", amount: 30_000 * R }] });
    expect(s.deals.t1).toMatchObject({ title: "Ремонт ванной", target: 100_000 * R, meta: { serviceId: "svc1", description: "4 м2" } });
    expect(s.deals.t1!.stages.map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(() => updateTerms(s, "t1", "ivan", { stages: [{ title: "", amount: 5 }] })).toThrow(EngineError);
  });

  it("отправка условий открывает резерв; после резерва вернуть на правку нельзя", () => {
    let s = updateTerms(draft(), "t1", "ivan", { stages: [{ title: "Плитка", amount: 100_000 * R }] });
    expect(() => proposeDeal(s, "t1", "anna", T0)).toThrow(EngineError);
    s = proposeDeal(s, "t1", "ivan", T0);
    expect(s.deals.t1!.status).toBe("funding");
    expect(() => updateTerms(s, "t1", "ivan", { title: "Поздно" })).toThrow(/верните сделку на согласование/);
    const back = reopenDeal(s, "t1", "ivan", T0); // заказчик попросил поправить в чате
    expect(back.deals.t1!.status).toBe("draft");
    s = fund(s, "t1", "anna", 100_000 * R, T0);
    expect(s.deals.t1!.status).toBe("active");
    expect(() => reopenDeal(s, "t1", "ivan", T0)).toThrow(EngineError);
    expect(totalMoney(s)).toBe(toppedUp(s));
  });

  it("черновик можно отменить обеим сторонам, без движения денег; пустые условия не отправить", () => {
    const d = draft();
    expect(() => proposeDeal({ ...d, deals: { t1: { ...d.deals.t1!, stages: [], target: 0 } } }, "t1", "ivan", T0)).toThrow(/добавьте этапы/);
    expect(cancelDeal(d, "t1", "ivan", T0).deals.t1!.status).toBe("cancelled");
    expect(cancelDeal(d, "t1", "anna", T0).deals.t1!.status).toBe("cancelled");
    expect(() => cancelDeal(d, "t1", "stranger", T0)).toThrow(EngineError);
    expect(() => createDeal(createState(), { id: "g", mode: "grant", title: "x", executorId: "a", ownerId: "b", status: "draft", stages: [{ title: "x", amount: 1 }], at: T0 })).toThrow(/только у личной/);
  });
});


describe("контракт сделки", () => {
  it("SHA-256 совпадает с эталонными значениями", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(sha256Hex("Оплата по шагам")).toHaveLength(64);
  });

  it("каноническая запись не зависит от порядка ключей", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: undefined, c: null }] })).toBe('{"a":[2,{"c":null}],"b":1}');
  });

  const deal = () => {
    let s = createState();
    s = topUp(s, "anna", 100_000 * R, T0);
    return createDeal(s, { id: "c1", mode: "own", title: "Ремонт", executorId: "ivan", ownerId: "anna", stages: [{ title: "Плитка", amount: 60_000 * R, criteria: ["Швы ровные"] }, { title: "Сантехника", amount: 40_000 * R }], at: T0 });
  };

  it("хеш фиксируется при создании и не зависит от хода работ", () => {
    let s = deal();
    const sealed = s.deals.c1!.contract!;
    expect(sealed).toMatchObject({ v: CONTRACT_VERSION, sealedAt: T0 });
    expect(sealed.hash).toHaveLength(64);
    expect(verifyContract(s.deals.c1!)).toMatchObject({ sealed: true, ok: true });
    s = fund(s, "c1", "anna", 100_000 * R, T0);
    s = submitStage(s, "c1", "s1", "ivan", { note: "готово" }, T0);
    s = approveStage(s, "c1", "s1", "anna", T0);
    expect(s.deals.c1!.contract!.hash).toBe(sealed.hash); // статусы и деньги условий не меняют
    expect(verifyContract(s.deals.c1!).ok).toBe(true);
  });

  it("любое изменение условий меняет хеш", () => {
    const d = deal().deals.c1!;
    const base = contractHash(contractTerms(d));
    const changed = (patch: (x: typeof d) => void) => {
      const c = structuredClone(d);
      patch(c);
      return contractHash(contractTerms(c));
    };
    expect(changed((x) => (x.stages[0]!.amount += 1))).not.toBe(base);
    expect(changed((x) => (x.stages[0]!.criteria = []))).not.toBe(base);
    expect(changed((x) => (x.executorId = "petr"))).not.toBe(base);
    expect(changed((x) => (x.autoAcceptMs += 1))).not.toBe(base);
    expect(changed((x) => (x.feeBps = 100))).not.toBe(base);
    expect(changed((x) => (x.title = "Другое"))).not.toBe(base);
  });

  it("подмена условий после фиксации останавливает резерв, выплату и автоприемку", () => {
    let s = deal();
    const tampered = (st: State) => {
      const c = structuredClone(st);
      c.deals.c1!.stages[0]!.amount = 90_000 * R;
      return c;
    };
    expect(() => fund(tampered(s), "c1", "anna", 100_000 * R, T0)).toThrow(/изменены после фиксации/);
    s = fund(s, "c1", "anna", 100_000 * R, T0);
    const funded = s;
    s = submitStage(s, "c1", "s1", "ivan", {}, T0);
    expect(() => approveStage(tampered(s), "c1", "s1", "anna", T0)).toThrow(/изменены после фиксации/);
    const stuck = tick(tampered(s), T0 + 10 * DAY_MS);
    expect(stuck.deals.c1!.stages[0]!.status).toBe("submitted"); // автоприемка не платит по подмененным условиям
    // отмена и возврат остаются доступными: деньги можно вернуть всегда
    expect(cancelDeal(tampered(funded), "c1", "anna", T0).deals.c1!.status).toBe("cancelled");
  });

  it("черновик не имеет контракта, отправка условий его фиксирует, возврат на правку снимает", () => {
    let s = createDeal(topUp(createState(), "anna", 100 * R, T0), { id: "d1", mode: "own", title: "Задача", executorId: "ivan", ownerId: "anna", status: "draft", stages: [], at: T0 });
    expect(s.deals.d1!.contract).toBeUndefined();
    s = updateTerms(s, "d1", "ivan", { stages: [{ title: "Работа", amount: 100 * R }] });
    s = proposeDeal(s, "d1", "ivan", T0 + 5);
    expect(s.deals.d1!.contract).toMatchObject({ sealedAt: T0 + 5 });
    const first = s.deals.d1!.contract!.hash;
    s = reopenDeal(s, "d1", "ivan", T0 + 6);
    expect(s.deals.d1!.contract).toBeUndefined();
    s = updateTerms(s, "d1", "ivan", { stages: [{ title: "Работа", amount: 90 * R }] });
    s = proposeDeal(s, "d1", "ivan", T0 + 9);
    expect(s.deals.d1!.contract!.hash).not.toBe(first);
  });

  it("сделка без контракта (созданная раньше) фиксируется при первом резерве", () => {
    const s0 = deal();
    const legacy = structuredClone(s0);
    delete legacy.deals.c1!.contract;
    const s = fund(legacy, "c1", "anna", 100_000 * R, T0 + 7);
    expect(s.deals.c1!.contract).toMatchObject({ sealedAt: T0 + 7, hash: s0.deals.c1!.contract!.hash });
  });
});

describe("журнал сделки", () => {
  const full = () => {
    let s = createState();
    s = topUp(s, "anna", 100_000 * R, T0);
    s = createDeal(s, { id: "j1", mode: "own", title: "Ремонт", executorId: "ivan", ownerId: "anna", arbiterId: "expert", stages: [{ title: "Плитка", amount: 60_000 * R }, { title: "Сантехника", amount: 40_000 * R }], at: T0 });
    s = fund(s, "j1", "anna", 100_000 * R, T0 + 1);
    s = submitStage(s, "j1", "s1", "ivan", { note: "готово" }, T0 + 2);
    s = approveStage(s, "j1", "s1", "anna", T0 + 3);
    return s;
  };

  it("события пишутся по порядку и образуют цепочку хешей", () => {
    const d = full().deals.j1!;
    expect(d.journal!.map((e) => e.type)).toEqual(["created", "reserved", "stage_submitted", "payout", "stage_accepted"]);
    expect(d.journal![0]!.prev).toBe(genesisHash("j1"));
    expect(d.journal![1]!.prev).toBe(d.journal![0]!.hash);
    expect(d.journal![0]!.data!.contract).toBe(d.contract!.hash);
    expect(d.journal![3]).toMatchObject({ by: "system", stageId: "s1", data: { amount: 60_000 * R } });
    expect(verifyJournal(d)).toMatchObject({ ok: true, count: 5, contractMatches: true, head: d.journal![4]!.hash });
  });

  it("подмена, удаление и перестановка записей ломают цепочку", () => {
    const d = full().deals.j1!;
    const edit = (fn: (j: NonNullable<typeof d.journal>) => void) => {
      const c = structuredClone(d);
      fn(c.journal!);
      return verifyEntries("j1", c.journal!);
    };
    expect(edit((j) => ((j[3]!.data as { amount: number }).amount = 1))).toMatchObject({ ok: false, brokenAt: 4 });
    expect(edit((j) => j.splice(2, 1))).toMatchObject({ ok: false, brokenAt: 3 });
    expect(edit((j) => ([j[1], j[2]] = [j[2]!, j[1]!]))).toMatchObject({ ok: false, brokenAt: 2 });
    expect(edit((j) => j.pop())).toMatchObject({ ok: true }); // обрезанный хвост виден по head и числу записей
    expect(verifyEntries("другая", d.journal!)).toMatchObject({ ok: false, brokenAt: 1 }); // журнал нельзя перенести в другую сделку
  });

  it("нарушенный журнал останавливает выплату и резерв, но не возврат", () => {
    let s = full();
    s = submitStage(s, "j1", "s2", "ivan", {}, T0 + 4);
    const bad = structuredClone(s);
    bad.deals.j1!.journal![1]!.data!.amount = 5;
    expect(() => approveStage(bad, "j1", "s2", "anna", T0 + 5)).toThrow(/Журнал сделки нарушен/);
    expect(verifyJournal(bad.deals.j1!)).toMatchObject({ ok: false, brokenAt: 2 });
    const fine = resolveDispute(rejectStage(s, "j1", "s2", "anna", "плохо", T0 + 5), "j1", "s2", "expert", "refund", T0 + 6);
    expect(fine.deals.j1!.status).toBe("cancelled");
    expect(fine.deals.j1!.journal!.map((e) => e.type)).toContain("refund");
    expect(verifyJournal(fine.deals.j1!).ok).toBe(true);
  });

  it("фиксация условий и разбор спора попадают в журнал; хеш контракта сверяется", () => {
    let s = createDeal(topUp(createState(), "anna", 100 * R, T0), { id: "j2", mode: "own", title: "Задача", executorId: "ivan", ownerId: "anna", arbiterId: "expert", status: "draft", stages: [], at: T0 });
    s = proposeDeal(updateTerms(s, "j2", "ivan", { stages: [{ title: "Работа", amount: 100 * R }] }), "j2", "ivan", T0 + 1);
    s = fund(s, "j2", "anna", 100 * R, T0 + 2);
    s = submitStage(s, "j2", "s1", "ivan", {}, T0 + 3);
    s = openDispute(s, "j2", "s1", "anna", "не готово", T0 + 4);
    s = replyDispute(s, "j2", "s1", "ivan", "готово", [], T0 + 5);
    s = resolveDispute(s, "j2", "s1", "expert", "pay", T0 + 6, "работа выполнена");
    const d = s.deals.j2!;
    expect(d.journal!.map((e) => e.type)).toEqual(["created", "terms_sealed", "reserved", "stage_submitted", "dispute_opened", "dispute_reply", "payout", "stage_accepted", "completed"]);
    expect(d.journal![7]).toMatchObject({ by: "expert", data: { closedBy: "arbiter", comment: "работа выполнена" } });
    expect(verifyJournal(d).ok).toBe(true);
    const tampered = structuredClone(d);
    tampered.contract!.hash = "0".repeat(64);
    expect(verifyJournal(tampered)).toMatchObject({ ok: false, contractMatches: false });
  });

  it("сделка без журнала (созданная раньше) начинает журнал с первого события", () => {
    const base = full();
    const legacy = structuredClone(base);
    delete legacy.deals.j1!.journal;
    expect(verifyJournal(legacy.deals.j1!)).toMatchObject({ ok: true, count: 0 });
    const s = submitStage(legacy, "j1", "s2", "ivan", {}, T0 + 9);
    expect(s.deals.j1!.journal!.map((e) => e.type)).toEqual(["stage_submitted"]);
    expect(verifyJournal(s.deals.j1!).ok).toBe(true);
  });
});

describe("подписи сторон", () => {
  const signedDeal = () => {
    let s = createState();
    s = topUp(s, "anna", 100_000 * R, T0);
    return createDeal(s, { id: "g1", mode: "own", title: "Ремонт", executorId: "ivan", ownerId: "anna", arbiterId: "expert", signed: true, stages: [{ title: "Плитка", amount: 100_000 * R }], at: T0 });
  };

  it("работа начинается после резерва и подписей обеих сторон, в любом порядке", () => {
    let s = fund(signedDeal(), "g1", "anna", 100_000 * R, T0 + 1);
    expect(s.deals.g1!.status).toBe("funding"); // деньги есть, подписей нет
    expect(() => submitStage(s, "g1", "s1", "ivan", {}, T0 + 2)).toThrow(EngineError);
    expect(signatureStatus(s.deals.g1!)).toMatchObject({ required: ["ivan", "anna"], signed: [], complete: false });
    s = signContract(s, "g1", "anna", T0 + 3, "sig-anna");
    expect(s.deals.g1!.status).toBe("funding");
    s = signContract(s, "g1", "ivan", T0 + 4, "sig-ivan");
    expect(s.deals.g1!.status).toBe("active");
    expect(s.deals.g1!.stages[0]!.status).toBe("active");
    expect(s.deals.g1!.journal!.map((e) => e.type)).toEqual(["created", "reserved", "signed", "signed", "activated"]);
    expect(totalMoney(s)).toBe(toppedUp(s));
  });

  it("подпись до резерва, чужая и повторная подписи отклоняются", () => {
    let s = signedDeal();
    expect(() => signContract(s, "g1", "stranger", T0, "x")).toThrow(/не сторона/);
    s = signContract(s, "g1", "ivan", T0 + 1, "sig-ivan");
    expect(() => signContract(s, "g1", "ivan", T0 + 2, "again")).toThrow(/уже подписали/);
    s = signContract(s, "g1", "anna", T0 + 2, "sig-anna");
    expect(s.deals.g1!.status).toBe("funding"); // подписано, но денег нет
    s = fund(s, "g1", "anna", 100_000 * R, T0 + 3);
    expect(s.deals.g1!.status).toBe("active");
  });

  it("повторный резерв по уже оплаченной сделке невозможен, подпись не нужна сделкам без подписей", () => {
    const s = fund(signedDeal(), "g1", "anna", 100_000 * R, T0 + 1);
    expect(() => fund(topUp(s, "anna", 100_000 * R, T0 + 2), "g1", "anna", 100_000 * R, T0 + 3)).toThrow(/уже зарезервирована/);
    const plain = createDeal(topUp(createState(), "anna", 10 * R, T0), { id: "p1", mode: "own", title: "x", executorId: "ivan", ownerId: "anna", stages: [{ title: "x", amount: 10 * R }], at: T0 });
    expect(fund(plain, "p1", "anna", 10 * R, T0).deals.p1!.status).toBe("active");
    expect(() => signContract(plain, "p1", "anna", T0, "x")).toThrow(/без отдельной подписи/);
  });

  it("подписи привязаны к хешу: возврат на правку их снимает, подмена условий блокирует подпись", () => {
    let s = createDeal(topUp(createState(), "anna", 100 * R, T0), { id: "g2", mode: "own", title: "Задача", executorId: "ivan", ownerId: "anna", signed: true, status: "draft", stages: [], at: T0 });
    expect(() => signContract(s, "g2", "ivan", T0, "x")).toThrow(/не зафиксирован/);
    s = proposeDeal(updateTerms(s, "g2", "ivan", { stages: [{ title: "Работа", amount: 100 * R }] }), "g2", "ivan", T0 + 1);
    s = signContract(s, "g2", "ivan", T0 + 2, "sig-ivan");
    const hash1 = s.deals.g2!.contract!.hash;
    expect(s.deals.g2!.signatures!.ivan).toMatchObject({ hash: hash1, sig: "sig-ivan" });
    s = reopenDeal(s, "g2", "ivan", T0 + 3);
    expect(s.deals.g2!.signatures).toBeUndefined();
    s = proposeDeal(updateTerms(s, "g2", "ivan", { stages: [{ title: "Работа", amount: 90 * R }] }), "g2", "ivan", T0 + 4);
    expect(s.deals.g2!.contract!.hash).not.toBe(hash1);
    const bad = structuredClone(s);
    bad.deals.g2!.stages[0]!.amount = 1;
    expect(() => signContract(bad, "g2", "anna", T0 + 5, "x")).toThrow(/изменены после фиксации/);
    // подпись под старым хешем не засчитывается
    const old = structuredClone(s);
    old.deals.g2!.signatures = { ivan: { at: T0, hash: hash1, sig: "old" } };
    expect(signatureStatus(old.deals.g2!).signed).toEqual([]);
  });

  it("краудфандинг: подписывает автор, спонсоры соглашаются взносом", () => {
    let s = topUp(topUp(createState(), "olga", 100 * R, T0), "max", 100 * R, T0);
    s = createDeal(s, { id: "c9", mode: "crowdfunding", title: "Игра", executorId: "ivan", signed: true, stages: [{ title: "Макет", amount: 100 * R }], at: T0 });
    expect(signatureStatus(s.deals.c9!).required).toEqual(["ivan"]);
    s = fund(fund(s, "c9", "olga", 50 * R, T0 + 1), "c9", "max", 50 * R, T0 + 2);
    expect(s.deals.c9!.status).toBe("funding");
    expect(() => signContract(s, "c9", "olga", T0 + 3, "x")).toThrow(/не сторона/);
    s = signContract(s, "c9", "ivan", T0 + 3, "sig-ivan");
    expect(s.deals.c9!.status).toBe("active");
  });

  it("отмена до подписей возвращает деньги", () => {
    const s = cancelDeal(fund(signedDeal(), "g1", "anna", 100_000 * R, T0 + 1), "g1", "anna", T0 + 2);
    expect(s.deals.g1!.status).toBe("cancelled");
    expect(freeBalance(s, "anna")).toBe(100_000 * R);
  });
});

describe("привязка сделки к контракту в сети", () => {
  const base = () => createDeal(topUp(createState(), "anna", 100 * R, T0), { id: "ch1", mode: "own", title: "x", executorId: "ivan", ownerId: "anna", stages: [{ title: "x", amount: 10 * R }], at: T0 });
  const link = { network: "Sepolia", chainId: 11155111, contract: "0x" + "ab".repeat(20), dealId: 1, explorer: "https://sepolia.etherscan.io/", txs: [{ label: "Резерв", hash: "0x" + "cd".repeat(32), at: T0 }] };

  it("сохраняет отчет, нормализует адрес обозревателя и пишет в журнал", () => {
    const s = linkChain(base(), "ch1", link, T0 + 1);
    expect(s.deals.ch1!.chain).toMatchObject({ network: "Sepolia", chainId: 11155111, explorer: "https://sepolia.etherscan.io" });
    expect(s.deals.ch1!.journal!.at(-1)).toMatchObject({ type: "chain_linked", data: { txs: 1 } });
    expect(verifyJournal(s.deals.ch1!).ok).toBe(true);
    expect(verifyContract(s.deals.ch1!).ok).toBe(true); // контракт сделки отчет не меняет
  });

  it("отклоняет неверные адреса, хеши и обозреватель", () => {
    const b = base();
    expect(() => linkChain(b, "ch1", { ...link, contract: "0x123" }, T0)).toThrow(EngineError);
    expect(() => linkChain(b, "ch1", { ...link, txs: [{ label: "x", hash: "0x12", at: T0 }] }, T0)).toThrow(EngineError);
    expect(() => linkChain(b, "ch1", { ...link, txs: [] }, T0)).toThrow(EngineError);
    expect(() => linkChain(b, "ch1", { ...link, explorer: "javascript:alert(1)" }, T0)).toThrow(EngineError);
    expect(() => linkChain(b, "ch1", { ...link, chainId: 0 }, T0)).toThrow(EngineError);
  });
});

describe("подпись ключом устройства в движке", () => {
  it("доказательство хранится вместе с подписью, метод попадает в журнал", () => {
    let s = createDeal(topUp(createState(), "anna", 100 * R, T0), { id: "k1", mode: "own", title: "x", executorId: "ivan", ownerId: "anna", arbiterId: "expert", signed: true, stages: [{ title: "x", amount: 100 * R }], at: T0 });
    const proof = { alg: "ES256" as const, keyId: "abcd", publicKey: "AAAA", message: "{}", signature: "BBBB" };
    s = signContract(s, "k1", "ivan", T0 + 1, "es256:abcd", proof);
    s = signContract(s, "k1", "anna", T0 + 2, "server-sig");
    expect(s.deals.k1!.signatures!.ivan).toMatchObject({ sig: "es256:abcd", proof });
    expect(s.deals.k1!.signatures!.anna!.proof).toBeUndefined();
    const signed = s.deals.k1!.journal!.filter((e) => e.type === "signed");
    expect(signed.map((e) => e.data)).toMatchObject([{ method: "device", keyId: "abcd" }, { method: "server" }]);
    expect(verifyJournal(s.deals.k1!).ok).toBe(true);
  });
});

describe("сроки и аварийный выход", () => {
  const own = (extra: Record<string, number> = {}) => {
    let s = topUp(createState(), "anna", 100 * R, T0);
    s = createDeal(s, { id: "e1", mode: "own", title: "x", executorId: "ivan", ownerId: "anna", arbiterId: "expert", stages: [{ title: "a", amount: 40 * R }, { title: "b", amount: 60 * R }], at: T0, ...extra });
    return fund(s, "e1", "anna", 100 * R, T0);
  };

  it("этап не сдан в срок: провал и возврат остатка, срок идет от начала этапа", () => {
    let s = own({ stageDeadlineDays: 10 });
    expect(() => expireStage(s, "e1", "s1", T0 + 9 * DAY_MS)).toThrow(EngineError);
    s = tick(s, T0 + 10 * DAY_MS);
    expect(s.deals.e1!.status).toBe("cancelled");
    expect(s.deals.e1!.stages[0]!.resolution?.by).toBe("expired");
    expect(freeBalance(s, "anna")).toBe(100 * R);
    expect(totalMoney(s)).toBe(toppedUp(s));
    expect(verifyJournal(s.deals.e1!).ok).toBe(true);
  });

  it("срок второго этапа идет от приемки первого", () => {
    let s = own({ stageDeadlineDays: 10 });
    s = submitStage(s, "e1", "s1", "ivan", {}, T0 + 5 * DAY_MS);
    s = approveStage(s, "e1", "s1", "anna", T0 + 6 * DAY_MS);
    s = tick(s, T0 + 15 * DAY_MS);
    expect(s.deals.e1!.status).toBe("active");
    s = expireStage(s, "e1", "s2", T0 + 16 * DAY_MS);
    expect(s.deals.e1!.status).toBe("cancelled");
    expect(freeBalance(s, "ivan")).toBe(40 * R);
    expect(freeBalance(s, "anna")).toBe(60 * R);
    expect(totalMoney(s)).toBe(toppedUp(s));
  });

  it("спор не решен в срок: возврат плательщику", () => {
    let s = own({ disputeDays: 14 });
    s = submitStage(s, "e1", "s1", "ivan", {}, T0 + 1);
    s = openDispute(s, "e1", "s1", "ivan", "нет", T0 + 3);
    expect(() => expireDispute(s, "e1", "s1", T0 + 3 + 13 * DAY_MS)).toThrow(EngineError);
    s = tick(s, T0 + 3 + 14 * DAY_MS);
    expect(s.deals.e1!.status).toBe("cancelled");
    expect(freeBalance(s, "anna")).toBe(100 * R);
    expect(totalMoney(s)).toBe(toppedUp(s));
  });

  it("срок сбора истек: сделка отменена, деньги вернулись", () => {
    let s = topUp(createState(), "p1", 50 * R, T0);
    s = createDeal(s, { id: "c1", mode: "crowdfunding", title: "x", executorId: "author", fundingDeadlineDays: 30, stages: [{ title: "a", amount: 100 * R }], at: T0 });
    s = fund(s, "c1", "p1", 50 * R, T0 + 1);
    expect(() => expireFunding(s, "c1", T0 + 29 * DAY_MS)).toThrow(EngineError);
    s = tick(s, T0 + 30 * DAY_MS);
    expect(s.deals.c1!.status).toBe("cancelled");
    expect(freeBalance(s, "p1")).toBe(50 * R);
    expect(s.deals.c1!.journal!.some((e) => e.type === "funding_expired")).toBe(true);
    expect(totalMoney(s)).toBe(toppedUp(s));
  });

  it("без сроков ничего не истекает", () => {
    let s = own();
    s = tick(s, T0 + 1000 * DAY_MS);
    expect(s.deals.e1!.status).toBe("active");
  });

  it("сроки входят в хеш условий только когда заданы", () => {
    const a = own();
    const b = own({ stageDeadlineDays: 10 });
    expect(contractHash(contractTerms(a.deals.e1!))).not.toBe(contractHash(contractTerms(b.deals.e1!)));
  });
});
