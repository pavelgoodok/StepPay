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
  rejectStage,
  reservedBalance,
  resolveDispute,
  splitProRata,
  submitStage,
  tick,
  topUp,
  voteStage,
  type State,
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
