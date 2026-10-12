import {
  approveStage,
  proposeDeal,
  updateTerms,
  createDeal,
  fund,
  submitStage,
  topUp,
  voteStage,
  createState,
  type State, signContract } from "@steppay/engine";
import { DEMO_DOC_ID, DEMO_PHOTO_ID } from "./demo-photo";
import { innFromNine } from "./inn";
import type { PlatformData, Platform, Project, Service } from "./platform";
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

/** Каталог платформы для демо: одобренные проекты (связаны со сделками выше), проект на проверке и карточки услуг. */
export function freshDemoPlatform(at: number): PlatformData {
  const photo = { id: "ph1", name: "Фото проекта", url: `/uploads/${DEMO_PHOTO_ID}`, kind: "photo" as const };
  const doc = { id: "d1", name: "Смета.pdf", url: `/uploads/${DEMO_DOC_ID}`, kind: "doc" as const };
  const mk = (id: string, ownerId: string, kind: Project["kind"], title: string, summary: string, category: string, stages: [string, number][], extra: Partial<Project> = {}): Project => ({
    id, ownerId, kind, title, summary, category,
    description: `${summary} Работаем по этапам: каждый этап принимается и оплачивается отдельно. Смета и план работ приложены к заявке.`,
    stages: stages.map(([t, rub]) => ({ title: t, amount: rub * R, criteria: [] })),
    docs: [photo, doc], status: "approved", history: [{ at, by: "admin", action: "approve" }], createdAt: at, updatedAt: at, ...extra,
  });
  const projects: Project[] = [
    mk("p_budget", "studio", "crowdfunding", "Приложение для семейного бюджета", "Приложение, где семья ведет общий бюджет и копит на цели вместе.", "Технологии", [["Прототип", 240_000], ["Разработка", 400_000], ["Запуск", 160_000]], { dealId: "seed-budget" }),
    mk("p_yard", "tsj", "crowdfunding", "Детская площадка во дворе", "Собираем на новую площадку для двух домов нашего двора.", "Городская среда", [["Сбор средств", 50_000], ["Проект и согласование", 70_000], ["Покупка оборудования", 230_000], ["Монтаж", 100_000]], { dealId: "seed-yard" }),
    mk("p_edu", "studio", "grant", "Технологии для образования", "Методика и материалы по цифровым навыкам для школ.", "Образование", [["Методика и материалы", 300_000], ["Пилот в школах", 500_000]], { dealId: "seed-edu", funderId: "fond" }),
    mk("p_culture", "tsj", "grant", "Культура районов", "Оборудование и фестиваль для районного культурного центра.", "Социальные проекты", [["Закупка оборудования", 200_000], ["Фестиваль", 300_000]], { dealId: "seed-culture", funderId: "fond" }),
    mk("p_library", "tsj", "grant", "Библиотека инструментов", "Общая библиотека инструментов для жителей района: берешь на выходные, возвращаешь.", "Социальные проекты", [["Закупка инструментов", 250_000], ["Помещение и запуск", 150_000]]),
    mk("p_album", "games", "crowdfunding", "Альбом группы «Тихий берег»", "Запись, сведение и выпуск дебютного альбома группы.", "Музыка и творчество", [["Запись", 150_000], ["Сведение", 70_000], ["Выпуск", 80_000]], { status: "review", history: [{ at, by: "games", action: "submit" }] }),
  ];
  const svc = (id: string, ownerId: string, title: string, category: string, description: string, priceFrom: number): Service => ({ id, ownerId, title, category, description, priceFrom: priceFrom * R, photos: [`/uploads/${DEMO_PHOTO_ID}`], active: true, createdAt: at, updatedAt: at });
  const services = [
    svc("svc_ivan", "ivan", "Ремонт ванных комнат и квартир", "Ремонт и строительство", "Плитка, электрика, сантехника, чистовая отделка. Работаю по этапам, фото каждого этапа присылаю сразу.", 60_000),
    svc("svc_studio", "studio", "Разработка сайтов и приложений", "Разработка и дизайн", "Лендинги, интернет-магазины, мобильные приложения. Дизайн, разработка и запуск отдельными этапами.", 80_000),
    svc("svc_games", "games", "Дизайн и печать настольных игр", "Разработка и дизайн", "Разработка механики, иллюстрации, макет и тираж настольных игр под ключ.", 120_000),
  ];
  return { projects, services, threads: [] };
}

/** Анкета автора для демо-проекта на проверке: ИНН синтетический, с верной контрольной цифрой. */
export const DEMO_AUTHOR = { legalStatus: "org" as const, inn: innFromNine("123456789"), orgName: "ООО «Тихий берег»", email: "band@example.com" };

export interface Narration {
  title: string;
  text: string;
  /** от чьего имени показать результат */
  viewAs: string;
  path: string;
}

export const DEMO_SCRIPT = [
  "Анна находит услугу Ивана и пишет ему в чат",
  "Иван регистрирует задачу: статус «Согласование»",
  "Иван разбивает задачу на этапы и отправляет условия",
  "Анна резервирует 300 000 ₽ - у Ивана «зарезервировано»",
  "Иван сдает этап «Плитка» с фото",
  "Анна жмет «Принял» - у Ивана сразу +120 000 ₽",
  "Автор подает проект «Тираж настольной игры» на проверку",
  "Администратор одобряет проект, сбор открыт",
  "Два спонсора вносят по 150 000 ₽ - проект стартует",
  "Автор сдает «Макет», спонсоры принимают - автору 100 000 ₽",
  "Автор срывает «Тираж»: остаток 200 000 ₽ возвращается спонсорам",
];

export interface PreparedStep {
  /** изменения денег и сделок: выполняются в общей очереди транзакций */
  apply(s: State): State;
  narration: Narration;
  /** действия платформы после денег (например, сообщение в чате) */
  after?: () => Promise<void>;
}

const DEMO_STAGES = [
  { id: "s1", title: "Плитка", amount: 120_000 * R, criteria: ["Швы ровные", "Плитка без сколов", "Уровень соблюден"] },
  { id: "s2", title: "Электрика", amount: 60_000 * R, criteria: ["Проводка проложена", "Розетки установлены"] },
  { id: "s3", title: "Сантехника", amount: 90_000 * R, criteria: ["Приборы установлены", "Нет протечек"] },
  { id: "s4", title: "Чистовая отделка", amount: 30_000 * R, criteria: ["Уборка после работ"] },
];

/** Один шаг сценария для жюри: платформа и сервер сами совершают действия за нужных участников. */
export type Signer = (dealId: string, hash: string, userId: string) => string;

export async function prepareDemoStep(platform: Platform, step: number, at: number, sign: Signer): Promise<PreparedStep> {
  const signAs = (s: State, dealId: string, userId: string) => signContract(s, dealId, userId, at, sign(dealId, s.deals[dealId]!.contract!.hash, userId));
  const same = (s: State) => s;
  const thread = () => platform.snapshot.threads.find((t) => t.serviceId === "svc_ivan" && t.customerId === "anna");
  switch (step) {
    case 1: {
      const th = await platform.openThread("svc_ivan", "anna");
      await platform.post(th.id, "anna", "Здравствуйте! Нужно переделать ванную, 4 кв. м: плитка, электрика, сантехника. Бюджет около 300 тысяч. Возьметесь?");
      await platform.post(th.id, "ivan", "Добрый день, возьмусь. Зарегистрирую задачу и разобью работы на этапы, чтобы вы платили по мере готовности.");
      return { apply: same, narration: { title: "Чат с исполнителем", text: "Анна нашла услугу в каталоге и написала Ивану. Детали обсуждаются в личном чате.", viewAs: "ivan", path: `/chats/${th.id}` } };
    }
    case 2: {
      const th = thread();
      return {
        apply: (s) => createDeal(s, { id: "demo-own", mode: "own", title: "Ремонт ванной", executorId: "ivan", ownerId: "anna", arbiterId: "expert", status: "draft", signed: true, stages: [], meta: { serviceId: "svc_ivan", chatId: th?.id, description: "Ванная 4 кв. м, полный ремонт" }, at }),
        after: async () => void (th && (await platform.post(th.id, "ivan", "Зарегистрирована задача «Ремонт ванной». Исполнитель согласует этапы и отправит условия.", "system", "demo-own"))),
        narration: { title: "Задача зарегистрирована", text: "Иван создал задачу по итогам разговора. У сделки статус «Согласование»: денег еще нет, условия правит исполнитель.", viewAs: "ivan", path: "/deals/demo-own" },
      };
    }
    case 3:
      return {
        apply: (s) => signAs(proposeDeal(updateTerms(s, "demo-own", "ivan", { stages: DEMO_STAGES }), "demo-own", "ivan", at), "demo-own", "ivan"),
        after: async () => void (thread() && (await platform.post(thread()!.id, "ivan", "Условия отправлены. Можно проверить этапы и зарезервировать деньги.", "system", "demo-own"))),
        narration: { title: "Условия отправлены", text: "Иван разбил работу на 4 этапа с суммами и критериями приемки и подписал контракт. Анна видит условия и может их принять.", viewAs: "anna", path: "/deals/demo-own" },
      };
    case 4:
      return { apply: (s) => fund(signAs(s, "demo-own", "anna"), "demo-own", "anna", 300_000 * R, at), narration: { title: "Контракт подписан, деньги зарезервированы", text: "Анна подписала контракт и заморозила 300 000 ₽ в кошельке. Подписи обеих сторон на месте, Иван приступает к работе.", viewAs: "ivan", path: "/deals/demo-own" } };
    case 5:
      return { apply: (s) => submitStage(s, "demo-own", "s1", "ivan", { note: "Плитка уложена, швы затерты, всё по уровню", photos: [PHOTO] }, at), narration: { title: "Этап сдан", text: "Иван приложил фото. Если Анна не ответит 3 дня, этап примется автоматически.", viewAs: "anna", path: "/deals/demo-own" } };
    case 6:
      return { apply: (s) => approveStage(s, "demo-own", "s1", "anna", at), narration: { title: "Этап принят, деньги у исполнителя", text: "Анна нажала «Принял»: Иван мгновенно получил 120 000 ₽, остальные 180 000 ₽ остаются в резерве.", viewAs: "ivan", path: "/wallet" } };
    case 7: {
      const p = await platform.createProject("games", {
        kind: "crowdfunding", title: "Тираж настольной игры", category: "Игры",
        summary: "Выпускаем тираж настольной игры для компании от двух до пяти человек.",
        description: "Игра готова на уровне прототипа, правила проверены на десятках партий. Собираем на печать макета и тиража. Каждый этап принимают спонсоры, деньги выплачиваются по мере готовности.",
        stages: [{ title: "Макет", amount: 100_000 * R, criteria: ["Готов макет и правила"] }, { title: "Тираж", amount: 200_000 * R, criteria: ["Тираж отпечатан и отправлен спонсорам"] }],
        docs: [{ id: "ph1", name: "Фото прототипа", url: PHOTO, kind: "photo" }, { id: "d1", name: "Смета на печать.pdf", url: `/uploads/${DEMO_DOC_ID}`, kind: "doc" }],
      });
      await platform.submitProject(p.id, "games");
      return { apply: same, narration: { title: "Проект на проверке", text: "Автор заполнил анкету, приложил фото и смету и отправил проект. Заявка появилась в панели администратора.", viewAs: "admin", path: "/admin" } };
    }
    case 8: {
      const p = platform.projects().find((x) => x.ownerId === "games" && x.title === "Тираж настольной игры" && x.status === "review");
      if (!p) throw new Error("Сначала выполните предыдущие шаги");
      await platform.decide(p.id, "admin", "approve");
      await platform.linkDeal(p.id, "demo-crowd");
      return {
        apply: (s) => createDeal(s, { id: "demo-crowd", mode: "crowdfunding", title: p.title, executorId: "games", signed: true, stages: p.stages.map((x, i) => ({ id: `s${i + 1}`, ...x })), meta: { projectId: p.id }, at }),
        narration: { title: "Проект одобрен", text: "Администратор изучил заявку и документы и одобрил проект. Он появился в каталоге, сбор открыт.", viewAs: "olga", path: "/deals/demo-crowd" },
      };
    }
    case 9:
      return { apply: (s) => fund(fund(signAs(s, "demo-crowd", "games"), "demo-crowd", "olga", 150_000 * R, at), "demo-crowd", "max", 150_000 * R, at), narration: { title: "Сбор завершен", text: "Автор подписал контракт, Ольга и Максим внесли по 150 000 ₽. Деньги не у автора, а в резерве до приемки этапов.", viewAs: "games", path: "/deals/demo-crowd" } };
    case 10:
      return {
        apply: (s) => {
          let n = submitStage(s, "demo-crowd", "s1", "games", { note: "Макет и правила готовы" }, at);
          n = voteStage(voteStage(n, "demo-crowd", "s1", "olga", "accept", at), "demo-crowd", "s1", "max", "accept", at);
          return n;
        },
        narration: { title: "Первый этап принят", text: "Спонсоры проголосовали «за»: автор получил 100 000 ₽ за макет.", viewAs: "games", path: "/wallet" },
      };
    case 11:
      return {
        apply: (s) => voteStage(submitStage(s, "demo-crowd", "s2", "games", { note: "Тираж задерживается, отправим часть" }, at), "demo-crowd", "s2", "olga", "reject", at),
        narration: { title: "Проект не сдал этап: остаток вернулся", text: "Спонсоры отклонили этап. Невыплаченные 200 000 ₽ вернулись Ольге и Максиму по 100 000 ₽, без споров и заявлений.", viewAs: "olga", path: "/wallet" },
      };
    default:
      throw new Error("Нет такого шага сценария");
  }
}
