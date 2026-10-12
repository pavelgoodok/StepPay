import {
  approveStage,
  createDeal,
  fund,
  submitStage,
  topUp,
  voteStage,
  createState,
  type State,
} from "@steppay/engine";
import { DEMO_PHOTO_ID } from "./demo-photo";
import { DEMO_USERS } from "./users";

const R = 100;
const PHOTO = `/uploads/${DEMO_PHOTO_ID}`;

export function seedUsers(s: State, at: number): State {
  let next = s;
  for (const u of DEMO_USERS) if (u.startBalance > 0) next = topUp(next, u.id, u.startBalance * R, at);
  return next;
}

/** Каталог проектов, чтобы вкладка «Проекты» не была пустой (названия - из макетов). */
export function seedCatalog(s: State, at: number): State {
  const sponsors = (st: State, id: string, parts: [string, number][]) => parts.reduce((acc, [who, rub]) => fund(acc, id, who, rub * R, at), st);
  let n = s;
  n = createDeal(n, { id: "seed-budget", mode: "crowdfunding", title: "Приложение для семейного бюджета", executorId: "studio", stages: [
    { title: "Прототип", amount: 240_000 * R }, { title: "Разработка", amount: 400_000 * R }, { title: "Запуск", amount: 160_000 * R } ], at });
  n = sponsors(n, "seed-budget", [["olga", 320_000], ["max", 320_000]]);
  n = createDeal(n, { id: "seed-yard", mode: "crowdfunding", title: "Детская площадка во дворе", executorId: "tsj", stages: [
    { title: "Сбор средств", amount: 50_000 * R }, { title: "Проект и согласование", amount: 70_000 * R }, { title: "Покупка оборудования", amount: 230_000 * R }, { title: "Монтаж", amount: 100_000 * R } ], at });
  n = sponsors(n, "seed-yard", [["olga", 90_000], ["max", 90_000]]);
  n = createDeal(n, { id: "seed-edu", mode: "grant", title: "Технологии для образования", executorId: "studio", ownerId: "fond", stages: [
    { title: "Методика и материалы", amount: 300_000 * R }, { title: "Пилот в школах", amount: 500_000 * R } ], at });
  n = fund(n, "seed-edu", "fond", 800_000 * R, at);
  n = createDeal(n, { id: "seed-culture", mode: "grant", title: "Культура районов", executorId: "tsj", ownerId: "fond", stages: [
    { title: "Закупка оборудования", amount: 200_000 * R }, { title: "Фестиваль", amount: 300_000 * R } ], at });
  return fund(n, "seed-culture", "fond", 500_000 * R, at);
}

/** Убирает демо-сделки, демо-кошельки и их операции (когда демо-режим выключен, а в базе остались старые демо-данные). */
export function purgeDemo(s: State): { state: State; changed: boolean } {
  const demoIds = new Set(DEMO_USERS.map((u) => u.id));
  const isDemoDeal = (id: string) => id.startsWith("seed-") || id.startsWith("demo-");
  const touchesDemo = Object.values(s.deals).some((d) => isDemoDeal(d.id) || demoIds.has(d.executorId) || (d.ownerId && demoIds.has(d.ownerId)));
  const hasDemoWallet = Object.keys(s.wallets).some((u) => demoIds.has(u));
  if (!touchesDemo && !hasDemoWallet) return { state: s, changed: false };
  const keep = Object.fromEntries(Object.entries(s.deals).filter(([id, d]) => !isDemoDeal(id) && !demoIds.has(d.executorId) && !(d.ownerId && demoIds.has(d.ownerId))));
  return {
    changed: true,
    state: {
      wallets: Object.fromEntries(Object.entries(s.wallets).filter(([u]) => !demoIds.has(u))),
      deals: keep,
      ledger: s.ledger.filter((l) => !demoIds.has(l.userId) && !(l.dealId && !keep[l.dealId])),
    },
  };
}

export const freshDemoState = (at: number) => seedCatalog(seedUsers(createState(), at), at);

export interface Narration {
  title: string;
  text: string;
  /** от чьего имени показать результат */
  viewAs: string;
  path: string;
}

export const DEMO_SCRIPT = [
  "Анна создает ремонт ванной за 300 000 ₽ в 4 этапа",
  "Анна резервирует деньги - у Ивана «300 000 ₽ зарезервировано»",
  "Иван сдает этап «Плитка» с фото",
  "Анна жмет «Принял» - у Ивана сразу +120 000 ₽",
  "Тот же движок: краудфандинг настольной игры на 300 000 ₽",
  "Два спонсора вносят по 150 000 ₽ - проект стартует",
  "Автор сдает «Макет», спонсоры принимают - автору 100 000 ₽",
  "Автор срывает «Тираж»: остаток 200 000 ₽ возвращается спонсорам",
];

/** Один шаг сценария для жюри: сервер сам совершает действия за нужных участников. */
export function runDemoStep(s: State, step: number, at: number): { state: State; narration: Narration } {
  switch (step) {
    case 1:
      return {
        state: createDeal(s, {
          id: "demo-own", mode: "own", title: "Ремонт ванной", executorId: "ivan", ownerId: "anna", arbiterId: "expert",
          stages: [
            { id: "s1", title: "Плитка", amount: 120_000 * R, criteria: ["Швы ровные", "Плитка без сколов", "Уровень соблюден"] },
            { id: "s2", title: "Электрика", amount: 60_000 * R, criteria: ["Проводка проложена", "Розетки установлены"] },
            { id: "s3", title: "Сантехника", amount: 90_000 * R, criteria: ["Приборы установлены", "Нет протечек"] },
            { id: "s4", title: "Чистовая отделка", amount: 30_000 * R, criteria: ["Уборка после работ"] },
          ], at,
        }),
        narration: { title: "Сделка создана", text: "Анна разбила ремонт на 4 этапа. Суммы и критерии приемки зафиксированы до начала работ.", viewAs: "anna", path: "/deals/demo-own" },
      };
    case 2:
      return {
        state: fund(s, "demo-own", "anna", 300_000 * R, at),
        narration: { title: "Деньги зарезервированы", text: "300 000 ₽ заморожены в цифровом кошельке. Иван видит, что деньги есть, и может спокойно работать.", viewAs: "ivan", path: "/deals/demo-own" },
      };
    case 3:
      return {
        state: submitStage(s, "demo-own", "s1", "ivan", { note: "Плитка уложена, швы затерты, все по уровню", photos: [PHOTO] }, at),
        narration: { title: "Этап сдан", text: "Иван приложил фото. Если Анна не ответит 3 дня - этап примется автоматически.", viewAs: "anna", path: "/deals/demo-own" },
      };
    case 4:
      return {
        state: approveStage(s, "demo-own", "s1", "anna", at),
        narration: { title: "Этап принят - деньги у исполнителя", text: "Анна нажала «Принял»: Иван мгновенно получил 120 000 ₽, остальные 180 000 ₽ остаются в резерве.", viewAs: "ivan", path: "/wallet" },
      };
    case 5:
      return {
        state: createDeal(s, {
          id: "demo-crowd", mode: "crowdfunding", title: "Тираж настольной игры", executorId: "games",
          stages: [{ id: "s1", title: "Макет", amount: 100_000 * R, criteria: ["Готов макет и правила"] }, { id: "s2", title: "Тираж", amount: 200_000 * R, criteria: ["Тираж отпечатан и отправлен спонсорам"] }], at,
        }),
        narration: { title: "Тот же движок - другой режим", text: "Краудфандинг: платит не один человек, а много спонсоров, а этап принимают голосованием. Механика та же.", viewAs: "olga", path: "/deals/demo-crowd" },
      };
    case 6: {
      const n = fund(fund(s, "demo-crowd", "olga", 150_000 * R, at), "demo-crowd", "max", 150_000 * R, at);
      return { state: n, narration: { title: "Сбор завершен", text: "Ольга и Максим внесли по 150 000 ₽. Деньги не у автора, а в резерве до приемки этапов.", viewAs: "games", path: "/deals/demo-crowd" } };
    }
    case 7: {
      let n = submitStage(s, "demo-crowd", "s1", "games", { note: "Макет и правила готовы" }, at);
      n = voteStage(voteStage(n, "demo-crowd", "s1", "olga", "accept", at), "demo-crowd", "s1", "max", "accept", at);
      return { state: n, narration: { title: "Первый этап принят", text: "Спонсоры проголосовали «за» - автор получил 100 000 ₽ за макет.", viewAs: "games", path: "/wallet" } };
    }
    case 8: {
      let n = submitStage(s, "demo-crowd", "s2", "games", { note: "Тираж задерживается, отправим часть" }, at);
      n = voteStage(n, "demo-crowd", "s2", "olga", "reject", at);
      return { state: n, narration: { title: "Проект не сдал этап - остаток вернулся", text: "Спонсоры отклонили этап. Невыплаченные 200 000 ₽ вернулись Ольге и Максиму по 100 000 ₽ - без споров и заявлений.", viewAs: "olga", path: "/wallet" } };
    }
    default:
      throw new Error("Нет такого шага сценария");
  }
}
