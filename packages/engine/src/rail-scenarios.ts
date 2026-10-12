import type { Scenario, Step } from "./rail";

/**
 * Общие сценарии для всех денежных рельсов. Ожидаемые числа посчитаны вручную и записаны здесь,
 * эмулятор на ядре сделок и контракт StepEscrow обязаны дать ровно их.
 * Суммы в копейках, R = рубль.
 */
const R = 100;
const START = 1_000_000 * R;

const sign = (by: string): Step => ({ do: "sign", by });
const reserve = (by: string, amount: number): Step => ({ do: "reserve", by, amount });
const submit = (by: string, stage: number): Step => ({ do: "submit", by, stage });
const approve = (by: string, stage: number): Step => ({ do: "approve", by, stage });
const bad = (s: Step): Step => ({ ...s, fails: true });

export const RAIL_SCENARIOS: Scenario[] = [
  {
    name: "своя сделка: резерв, подписи, четыре этапа принимаются, все деньги у исполнителя",
    balances: { anna: START },
    deal: { mode: "own", executor: "ivan", owner: "anna", arbiter: "expert", stages: [120_000 * R, 60_000 * R, 90_000 * R, 30_000 * R], autoAcceptDays: 3, feeBps: 0 },
    steps: [
      reserve("anna", 300_000 * R), sign("ivan"), sign("anna"),
      submit("ivan", 0), approve("anna", 0), submit("ivan", 1), approve("anna", 1),
      submit("ivan", 2), approve("anna", 2), submit("ivan", 3), approve("anna", 3),
    ],
    expect: { balances: { anna: 700_000 * R, ivan: 300_000 * R, platform: 0 }, status: "completed", stages: ["accepted", "accepted", "accepted", "accepted"] },
  },
  {
    name: "своя сделка: отказ открывает спор, приемщик возвращает деньги заказчику",
    balances: { anna: START },
    deal: { mode: "own", executor: "ivan", owner: "anna", arbiter: "expert", stages: [100_000 * R, 100_000 * R], autoAcceptDays: 3, feeBps: 0 },
    steps: [
      sign("anna"), reserve("anna", 200_000 * R), sign("ivan"),
      submit("ivan", 0), { do: "reject", by: "anna", stage: 0 },
      bad(approve("anna", 0)), // этап в споре
      bad({ do: "resolve", by: "anna", stage: 0, pay: false }), // решает только приемщик
      { do: "resolve", by: "expert", stage: 0, pay: false },
    ],
    expect: { balances: { anna: START, ivan: 0, platform: 0 }, status: "cancelled", stages: ["failed", "pending"] },
  },
  {
    name: "своя сделка: исполнитель открывает спор, приемщик выплачивает, затем заказчик отменяет остаток",
    balances: { anna: START },
    deal: { mode: "own", executor: "ivan", owner: "anna", arbiter: "expert", stages: [100_000 * R, 100_000 * R], autoAcceptDays: 3, feeBps: 0 },
    steps: [
      reserve("anna", 200_000 * R), sign("ivan"), sign("anna"),
      submit("ivan", 0), { do: "dispute", by: "ivan", stage: 0 }, { do: "resolve", by: "expert", stage: 0, pay: true },
      bad({ do: "cancel", by: "ivan" }), // отменяет заказчик
      { do: "cancel", by: "anna" },
    ],
    expect: { balances: { anna: START - 100_000 * R, ivan: 100_000 * R, platform: 0 }, status: "cancelled", stages: ["accepted", "active"] },
  },
  {
    name: "своя сделка: автоприемка срабатывает только после срока",
    balances: { anna: START },
    deal: { mode: "own", executor: "ivan", owner: "anna", arbiter: "expert", stages: [50_000 * R], autoAcceptDays: 3, feeBps: 0 },
    steps: [
      reserve("anna", 50_000 * R), sign("ivan"), sign("anna"), submit("ivan", 0),
      bad({ do: "autoAccept", stage: 0 }),
      { do: "wait", seconds: 3 * 86_400 - 100 }, bad({ do: "autoAccept", stage: 0 }),
      { do: "wait", seconds: 200 }, { do: "autoAccept", by: "stranger", stage: 0 },
    ],
    expect: { balances: { anna: START - 50_000 * R, ivan: 50_000 * R, platform: 0 }, status: "completed", stages: ["accepted"] },
  },
  {
    name: "своя сделка: комиссия платформы 2,5 процента",
    balances: { anna: START },
    deal: { mode: "own", executor: "ivan", owner: "anna", arbiter: "expert", stages: [100_000 * R], autoAcceptDays: 3, feeBps: 250 },
    steps: [reserve("anna", 100_000 * R), sign("ivan"), sign("anna"), submit("ivan", 0), approve("anna", 0)],
    expect: { balances: { anna: START - 100_000 * R, ivan: 97_500 * R, platform: 2_500 * R }, status: "completed", stages: ["accepted"] },
  },
  {
    name: "своя сделка: отмена до подписей возвращает весь резерв",
    balances: { anna: START },
    deal: { mode: "own", executor: "ivan", owner: "anna", arbiter: "expert", stages: [100_000 * R, 50_000 * R], autoAcceptDays: 3, feeBps: 0 },
    steps: [reserve("anna", 150_000 * R), bad({ do: "cancel", by: "ivan" }), sign("ivan"), { do: "cancel", by: "anna" }, bad({ do: "cancel", by: "anna" })],
    expect: { balances: { anna: START, ivan: 0, platform: 0 }, status: "cancelled", stages: ["pending", "pending"] },
  },
  {
    name: "краудфандинг: голосование спонсоров, провал второго этапа возвращает остаток поровну",
    balances: { olga: START, max: START },
    deal: { mode: "crowdfunding", executor: "author", stages: [100_000 * R, 200_000 * R], autoAcceptDays: 1, feeBps: 0 },
    steps: [
      bad(reserve("author", 100 * R)), // автор не спонсирует себя
      reserve("olga", 150_000 * R), bad(reserve("max", 200_000 * R)), reserve("max", 150_000 * R),
      bad(sign("olga")), sign("author"),
      submit("author", 0),
      bad({ do: "vote", by: "stranger", stage: 0, accept: true }),
      { do: "vote", by: "olga", stage: 0, accept: true },
      { do: "vote", by: "max", stage: 0, accept: true },
      submit("author", 1),
      { do: "vote", by: "olga", stage: 1, accept: false },
    ],
    expect: { balances: { author: 100_000 * R, olga: START - 150_000 * R + 100_000 * R, max: START - 150_000 * R + 100_000 * R, platform: 0 }, status: "cancelled", stages: ["accepted", "failed"] },
  },
  {
    name: "краудфандинг: неровные взносы, копейки делятся методом наибольших остатков и не теряются",
    balances: { olga: START, max: START, pasha: START },
    deal: { mode: "crowdfunding", executor: "author", stages: [100_000, 100_000, 100_000], autoAcceptDays: 1, feeBps: 0 },
    steps: [
      reserve("olga", 100_001), reserve("max", 100_002), reserve("pasha", 99_997), sign("author"),
      submit("author", 0),
      { do: "vote", by: "olga", stage: 0, accept: true }, { do: "vote", by: "max", stage: 0, accept: true },
      submit("author", 1),
      { do: "vote", by: "olga", stage: 1, accept: false }, { do: "vote", by: "max", stage: 1, accept: false },
    ],
    // выплата 100 000 делится 33 334 / 33 334 / 33 332, остатки резервов 66 667 / 66 668 / 66 665 возвращаются
    expect: { balances: { author: 100_000, olga: START - 100_001 + 66_667, max: START - 100_002 + 66_668, pasha: START - 99_997 + 66_665, platform: 0 }, status: "cancelled", stages: ["accepted", "failed", "pending"] },
  },
  {
    name: "краудфандинг: автоприемка через сутки без голосов",
    balances: { olga: START },
    deal: { mode: "crowdfunding", executor: "author", stages: [100_000 * R], autoAcceptDays: 1, feeBps: 0 },
    steps: [
      reserve("olga", 100_000 * R), sign("author"), submit("author", 0),
      bad({ do: "autoAccept", stage: 0 }), { do: "wait", seconds: 86_401 }, { do: "autoAccept", by: "stranger", stage: 0 },
    ],
    expect: { balances: { author: 100_000 * R, olga: START - 100_000 * R, platform: 0 }, status: "completed", stages: ["accepted"] },
  },
  {
    name: "грант: грантодатель принимает этап, второй отклоняет, автоприемки нет",
    balances: { fond: START },
    deal: { mode: "grant", executor: "studio", owner: "fond", stages: [50_000 * R, 50_000 * R], autoAcceptDays: 0, feeBps: 0 },
    steps: [
      reserve("fond", 100_000 * R), sign("fond"), sign("studio"),
      submit("studio", 0), approve("fond", 0), submit("studio", 1),
      { do: "wait", seconds: 30 * 86_400 }, bad({ do: "autoAccept", stage: 1 }),
      { do: "reject", by: "fond", stage: 1 },
    ],
    expect: { balances: { studio: 50_000 * R, fond: START - 50_000 * R, platform: 0 }, status: "cancelled", stages: ["accepted", "failed"] },
  },
  {
    name: "права и порядок действий: чужие и преждевременные вызовы отклоняются, деньги не двигаются",
    balances: { anna: START },
    deal: { mode: "own", executor: "ivan", owner: "anna", arbiter: "expert", stages: [100_000 * R], autoAcceptDays: 3, feeBps: 0 },
    steps: [
      bad(reserve("stranger", 100_000 * R)), bad(reserve("anna", 1 * R)),
      reserve("anna", 100_000 * R), bad(reserve("anna", 100_000 * R)),
      bad(submit("ivan", 0)), // еще не подписано
      bad(sign("stranger")), sign("anna"), bad(sign("anna")), sign("ivan"),
      bad(submit("anna", 0)), bad(approve("ivan", 0)), // этап еще не сдан
      submit("ivan", 0), bad(approve("ivan", 0)), bad(approve("stranger", 0)),
      bad({ do: "vote", by: "anna", stage: 0, accept: true }), // голосование только в краудфандинге
      bad({ do: "resolve", by: "expert", stage: 0, pay: true }), // спора нет
      bad({ do: "cancel", by: "anna" }), // этап на приемке
      approve("anna", 0),
    ],
    expect: { balances: { anna: START - 100_000 * R, ivan: 100_000 * R, platform: 0 }, status: "completed", stages: ["accepted"] },
  },
];
