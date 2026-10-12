import { sha256Hex } from "./sha256";
import type { Deal, Money, Mode, UserId } from "./types";

/**
 * Контракт сделки: формальное описание условий, которые обе стороны видят до резерва.
 * Любое изменение условий меняет хеш. Контракт не зависит от платформы, на которой исполняется.
 */
export const CONTRACT_VERSION = 1;

export interface ContractRules {
  /** кто принимает этап */
  approval: "owner" | "sponsors_majority";
  /** что происходит при отказе */
  onReject: "dispute" | "refund";
  /** кто решает спор (только при onReject = dispute) */
  arbiter: boolean;
  /** принимается ли этап сам, если ответа нет за autoAcceptMs */
  autoAccept: boolean;
}

export interface ContractTerms {
  v: number;
  dealId: string;
  mode: Mode;
  title: string;
  executorId: UserId;
  ownerId: UserId | null;
  arbiterId: UserId | null;
  stages: { id: string; title: string; amount: Money; criteria: string[] }[];
  target: Money;
  autoAcceptMs: number;
  feeBps: number;
  rules: ContractRules;
  /** сроки: поля есть, только если заданы */
  fundingDeadlineMs?: number;
  stageDeadlineMs?: number;
  disputeMs?: number;
  /** кто должен подписать контракт; поля нет у сделок без подписей */
  signers?: UserId[];
}

export interface SealedContract {
  v: number;
  hash: string;
  sealedAt: number;
}

export function contractRules(mode: Mode): ContractRules {
  if (mode === "own") return { approval: "owner", onReject: "dispute", arbiter: true, autoAccept: true };
  if (mode === "crowdfunding") return { approval: "sponsors_majority", onReject: "refund", arbiter: false, autoAccept: true };
  return { approval: "owner", onReject: "refund", arbiter: false, autoAccept: false };
}

/** Кто подписывает: личная сделка и грант - обе стороны, краудфандинг - автор (спонсоры соглашаются взносом). */
export function requiredSigners(d: Deal): UserId[] | undefined {
  if (!d.signing) return undefined;
  return d.mode === "crowdfunding" || !d.ownerId ? [d.executorId] : [d.executorId, d.ownerId];
}

export function contractTerms(d: Deal): ContractTerms {
  return {
    v: CONTRACT_VERSION,
    dealId: d.id,
    mode: d.mode,
    title: d.title,
    executorId: d.executorId,
    ownerId: d.ownerId ?? null,
    arbiterId: d.arbiterId ?? null,
    stages: d.stages.map((x) => ({ id: x.id, title: x.title, amount: x.amount, criteria: [...x.criteria] })),
    target: d.target,
    autoAcceptMs: d.autoAcceptMs,
    feeBps: d.feeBps,
    rules: contractRules(d.mode),
    fundingDeadlineMs: d.fundingDeadlineMs || undefined,
    stageDeadlineMs: d.stageDeadlineMs || undefined,
    disputeMs: d.disputeMs || undefined,
    signers: requiredSigners(d),
  };
}

/** Каноническая запись: ключи по алфавиту, без пробелов. Одни и те же условия всегда дают одну строку. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

export const contractHash = (terms: ContractTerms): string => sha256Hex(canonicalJson(terms));

export function sealContract(d: Deal, at: number): void {
  d.contract = { v: CONTRACT_VERSION, hash: contractHash(contractTerms(d)), sealedAt: at };
}

export interface ContractCheck {
  sealed: boolean;
  /** хеш текущих условий совпал с зафиксированным */
  ok: boolean;
  expected?: string;
  actual: string;
}

export function verifyContract(d: Deal): ContractCheck {
  const actual = contractHash(contractTerms(d));
  if (!d.contract) return { sealed: false, ok: false, actual };
  return { sealed: true, ok: d.contract.hash === actual, expected: d.contract.hash, actual };
}

export interface SignatureStatus {
  required: UserId[];
  signed: UserId[];
  /** все нужные подписи поставлены под текущим хешем */
  complete: boolean;
}

export function signatureStatus(d: Deal): SignatureStatus {
  const required = d.contract ? (requiredSigners(d) ?? []) : [];
  const signed = required.filter((u) => d.signatures?.[u]?.hash === d.contract?.hash);
  return { required, signed, complete: signed.length === required.length };
}

/** Контракт без подписей (старые сделки) считается вступившим в силу сразу. */
export const signaturesComplete = (d: Deal): boolean => !d.signing || signatureStatus(d).complete;
