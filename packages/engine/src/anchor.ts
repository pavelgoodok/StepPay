import { canonicalJson } from "./contract";
import { verifyEntries } from "./journal";
import { sha256Hex } from "./sha256";
import type { State } from "./types";

/**
 * Якорь: снимок «отпечатков» всей истории на момент времени. Он связывает три вещи:
 * концы цепочек журналов всех сделок, хеш журнала операций с деньгами и предыдущий якорь.
 * Корень якоря публикуется вне сервера (чужой журнал, сеть, свидетель). Тогда оператор, переписавший базу задним числом,
 * не может сделать это незаметно: прежние корни уже лежат у других и не совпадут с пересчитанными.
 */
export interface AnchorLeaf {
  id: string;
  /** сколько записей было в журнале сделки */
  len: number;
  /** хеш последней записи */
  head: string;
}

export interface Anchor {
  v: 1;
  n: number;
  at: number;
  /** корень предыдущего якоря (у первого: начальное значение) */
  prev: string;
  leaves: AnchorLeaf[];
  ledgerLen: number;
  /** хеш журнала операций с деньгами на этот момент */
  ledgerHash: string;
  root: string;
}

export const ANCHOR_GENESIS = sha256Hex("steppay/anchor/genesis");

const ledgerPrefixHash = (s: State, len: number) => sha256Hex(canonicalJson(s.ledger.slice(0, len)));

export const anchorRoot = (a: Omit<Anchor, "root">) => sha256Hex(canonicalJson(a));

/** Строит следующий якорь по текущему состоянию. */
export function buildAnchor(s: State, prev: Anchor | null, at: number): Anchor {
  const leaves = Object.values(s.deals)
    .filter((d) => (d.journal?.length ?? 0) > 0)
    .map((d) => ({ id: d.id, len: d.journal!.length, head: d.journal![d.journal!.length - 1]!.hash }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const body = { v: 1 as const, n: (prev?.n ?? 0) + 1, at, prev: prev?.root ?? ANCHOR_GENESIS, leaves, ledgerLen: s.ledger.length, ledgerHash: ledgerPrefixHash(s, s.ledger.length) };
  return { ...body, root: anchorRoot(body) };
}

/** Состояние изменилось с прошлого якоря: появились записи в журналах или операции с деньгами. */
export function changedSince(s: State, last: Anchor | null): boolean {
  if (!last) return s.ledger.length > 0 || Object.values(s.deals).some((d) => (d.journal?.length ?? 0) > 0);
  const a = buildAnchor(s, { ...last, root: last.root }, last.at);
  return a.ledgerLen !== last.ledgerLen || a.ledgerHash !== last.ledgerHash || canonicalJson(a.leaves) !== canonicalJson(last.leaves);
}

/** Цепочка якорей: номера идут подряд, каждый указывает на корень предыдущего, корень соответствует содержимому. */
export function verifyAnchorChain(list: Anchor[]): { ok: boolean; brokenAt?: number; reason?: string } {
  let prev = ANCHOR_GENESIS;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    const { root, ...body } = a;
    if (a.n !== i + 1) return { ok: false, brokenAt: a.n, reason: "нарушена нумерация" };
    if (a.prev !== prev) return { ok: false, brokenAt: a.n, reason: "якорь не продолжает предыдущий" };
    if (root !== anchorRoot(body)) return { ok: false, brokenAt: a.n, reason: "корень якоря не соответствует содержимому" };
    prev = root;
  }
  return { ok: true };
}

export interface AnchorProblem {
  anchor: number;
  dealId?: string;
  reason: string;
}

/** Сверка истории с якорями: ничего из зафиксированного не должно исчезнуть или измениться. */
export function checkAgainstAnchors(s: State, list: Anchor[]): AnchorProblem[] {
  const out: AnchorProblem[] = [];
  for (const a of list) {
    for (const leaf of a.leaves) {
      const d = s.deals[leaf.id];
      if (!d) {
        out.push({ anchor: a.n, dealId: leaf.id, reason: "сделка из якоря пропала" });
        continue;
      }
      const j = d.journal ?? [];
      if (j.length < leaf.len) out.push({ anchor: a.n, dealId: leaf.id, reason: "журнал стал короче, чем в якоре" });
      else if (j[leaf.len - 1]!.hash !== leaf.head) out.push({ anchor: a.n, dealId: leaf.id, reason: "записи журнала изменены после якоря" });
    }
    if (s.ledger.length < a.ledgerLen) out.push({ anchor: a.n, reason: "журнал операций стал короче, чем в якоре" });
    else if (ledgerPrefixHash(s, a.ledgerLen) !== a.ledgerHash) out.push({ anchor: a.n, reason: "журнал операций изменен после якоря" });
  }
  // сами журналы сделок должны быть целыми
  for (const d of Object.values(s.deals)) {
    const v = verifyEntries(d.id, d.journal ?? []);
    if (!v.ok) out.push({ anchor: 0, dealId: d.id, reason: "цепочка журнала нарушена" });
  }
  return out;
}

/** Деньги сходятся с журналом операций: кошельки восстанавливаются из него, резервы сделок равны остатку по операциям. */
export function verifyMoney(s: State): string[] {
  const out: string[] = [];
  const byUser: Record<string, number> = {};
  const byDeal: Record<string, { reserve: number; out: number }> = {};
  for (const e of s.ledger) {
    byUser[e.userId] = (byUser[e.userId] ?? 0) + (e.type === "reserve" ? -e.amount : e.amount);
    if (e.dealId) {
      const x = (byDeal[e.dealId] ??= { reserve: 0, out: 0 });
      if (e.type === "reserve") x.reserve += e.amount;
      else if (e.type !== "topup") x.out += e.amount;
    }
  }
  for (const u of new Set([...Object.keys(byUser), ...Object.keys(s.wallets)])) {
    if ((s.wallets[u] ?? 0) !== (byUser[u] ?? 0)) out.push(`кошелек ${u} не сходится с журналом операций`);
  }
  for (const d of Object.values(s.deals)) {
    const held = Object.values(d.reserves).reduce((a, b) => a + b, 0);
    const x = byDeal[d.id] ?? { reserve: 0, out: 0 };
    if (x.reserve - x.out !== held) out.push(`резерв сделки ${d.id} не сходится с журналом операций`);
  }
  return out;
}
