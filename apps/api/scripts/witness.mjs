#!/usr/bin/env node
// Независимый свидетель: запоминает корни якорей, которые отдает сервер, и тревожит, если история переписана.
// Запускать вне сервера, по расписанию (cron, GitHub Actions, чужой компьютер):
//   node scripts/witness.mjs https://api.example.com witness.json
// Выход 0: все прежние корни на месте, новые якоря продолжают цепочку. Выход 1: найдено расхождение.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const [, , api, file = "witness.json"] = process.argv;
if (!api) {
  console.error("Использование: node witness.mjs <адрес API> [файл свидетеля]");
  process.exit(2);
}
const GENESIS = createHash("sha256").update("steppay/anchor/genesis").digest("hex");
const seen = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { anchors: [] };

const res = await fetch(api.replace(/\/$/, "") + "/anchors", { signal: AbortSignal.timeout(15_000) });
if (!res.ok) {
  console.error(`сервер ответил ${res.status}`);
  process.exit(2);
}
const { anchors } = await res.json();
const problems = [];

// 1) все прежние корни должны остаться прежними
for (const old of seen.anchors) {
  const now = anchors.find((a) => a.n === old.n);
  if (!now) problems.push(`якорь №${old.n} пропал`);
  else if (now.root !== old.root) problems.push(`корень якоря №${old.n} изменился: было ${old.root.slice(0, 12)}, стало ${now.root.slice(0, 12)}`);
}
// 2) цепочка непрерывна: номера подряд, каждый указывает на корень предыдущего
let prev = GENESIS;
anchors.forEach((a, i) => {
  if (a.n !== i + 1) problems.push(`нарушена нумерация на якоре №${a.n}`);
  if (a.prev !== prev) problems.push(`якорь №${a.n} не продолжает предыдущий`);
  prev = a.root;
});
// 3) журнал операций с деньгами только растет
for (let i = 1; i < anchors.length; i++) if (anchors[i].ledgerLen < anchors[i - 1].ledgerLen) problems.push(`журнал операций стал короче на якоре №${anchors[i].n}`);

if (problems.length) {
  console.error("ТРЕВОГА: история могла быть переписана\n- " + problems.join("\n- "));
  process.exit(1);
}
writeFileSync(file, JSON.stringify({ checkedAt: new Date().toISOString(), anchors: anchors.map(({ n, root, at }) => ({ n, root, at })) }, null, 2));
console.log(`ок: якорей ${anchors.length}, новых ${anchors.length - seen.anchors.length}`);
