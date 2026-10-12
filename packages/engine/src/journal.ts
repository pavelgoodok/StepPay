import { canonicalJson } from "./contract";
import { sha256Hex } from "./sha256";
import type { Deal, JournalEntry } from "./types";

/**
 * Журнал сделки: каждое событие хранит хеш предыдущей записи. Подмена, удаление или перестановка
 * записей ломает цепочку, и это видно при проверке.
 */

export const genesisHash = (dealId: string) => sha256Hex(`steppay/genesis/${dealId}`);

const entryHash = (e: Omit<JournalEntry, "hash">) =>
  sha256Hex(canonicalJson({ n: e.n, at: e.at, type: e.type, by: e.by, stageId: e.stageId, data: e.data, prev: e.prev }));

export function record(d: Deal, at: number, type: string, by: string, data?: Record<string, unknown>, stageId?: string): void {
  const j = (d.journal ??= []);
  const prev = j.length ? j[j.length - 1]!.hash : genesisHash(d.id);
  const body = { n: j.length + 1, at, type, by, stageId, data, prev };
  j.push({ ...body, hash: entryHash(body) });
}

export interface JournalCheck {
  ok: boolean;
  count: number;
  /** номер первой нарушенной записи */
  brokenAt?: number;
  /** хеш последней записи: по нему можно сверить журнал, не передавая его целиком */
  head?: string;
  /** хеш контракта из последней записи о фиксации условий совпал с контрактом сделки */
  contractMatches: boolean;
}

export function verifyEntries(dealId: string, entries: JournalEntry[]): { ok: boolean; brokenAt?: number; head?: string } {
  let prev = genesisHash(dealId);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const { hash, ...body } = e;
    if (e.n !== i + 1 || e.prev !== prev || entryHash(body) !== hash) return { ok: false, brokenAt: i + 1 };
    prev = hash;
  }
  return { ok: true, head: entries.length ? prev : undefined };
}

export function verifyJournal(d: Deal): JournalCheck {
  const entries = d.journal ?? [];
  const r = verifyEntries(d.id, entries);
  const sealed = [...entries].reverse().find((e) => typeof e.data?.contract === "string");
  const contractMatches = !d.contract || !sealed || sealed.data!.contract === d.contract.hash;
  return { ok: r.ok && contractMatches, count: entries.length, brokenAt: r.brokenAt, head: r.head, contractMatches };
}
