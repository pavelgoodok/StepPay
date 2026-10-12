import { createHash, createPublicKey, verify } from "node:crypto";
import type { SignatureProof } from "@steppay/engine";

/**
 * Ключи подписи на устройстве: ECDSA P-256, закрытый ключ создается в браузере (WebCrypto) без права экспорта
 * и никогда не покидает устройство. Сервер хранит только открытый ключ и проверяет подписи.
 */
export interface DeviceKey {
  id: string;
  /** открытый ключ, SPKI в base64 */
  publicKey: string;
  label: string;
  createdAt: number;
  revokedAt?: number;
}

export const MAX_KEYS = 5;

/** Отпечаток ключа: первые 16 символов SHA-256 от SPKI. */
export const keyIdOf = (publicKeyB64: string) => createHash("sha256").update(Buffer.from(publicKeyB64, "base64")).digest("hex").slice(0, 16);

function importKey(publicKeyB64: string) {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
    return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1" ? key : null;
  } catch {
    return null;
  }
}

export const isValidPublicKey = (publicKeyB64: string) => importKey(publicKeyB64) !== null;

/** Проверка подписи ECDSA P-256 SHA-256 в формате r||s (так подписывает WebCrypto). */
export function verifyEs256(publicKeyB64: string, message: string, signatureB64: string): boolean {
  const key = importKey(publicKeyB64);
  if (!key) return false;
  try {
    return verify("sha256", Buffer.from(message, "utf8"), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/** Сообщение, которое подписывает сторона контракта. Поля идут в фиксированном порядке. */
export const signMessage = (dealId: string, contract: string, userId: string, at: number) =>
  JSON.stringify({ v: 1, kind: "steppay.sign", dealId, contract, userId, at });

/** Сообщение, которым ключ подтверждает владение при регистрации. */
export const registerMessage = (userId: string, publicKey: string, at: number) =>
  JSON.stringify({ v: 1, kind: "steppay.register", userId, keyId: keyIdOf(publicKey), at });

const SKEW_MS = 24 * 60 * 60 * 1000;

function parse(message: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(message);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface ExpectedSign {
  dealId: string;
  contract: string;
  userId: string;
}

/** Подпись под контрактом: подпись верна, а в сообщении именно эта сделка, этот хеш и этот подписант. */
export function checkSignProof(p: SignatureProof, want: ExpectedSign, nowMs?: number): string | null {
  const m = parse(p.message);
  if (!m || m.v !== 1 || m.kind !== "steppay.sign") return "Неверное сообщение подписи";
  if (m.dealId !== want.dealId || m.contract !== want.contract || m.userId !== want.userId) return "Подпись относится к другой сделке, другим условиям или другому пользователю";
  if (nowMs !== undefined && (typeof m.at !== "number" || Math.abs(nowMs - m.at) > SKEW_MS)) return "Время подписи не совпадает с временем сервера";
  if (p.keyId !== keyIdOf(p.publicKey)) return "Отпечаток не соответствует ключу";
  if (!verifyEs256(p.publicKey, p.message, p.signature)) return "Подпись не прошла проверку";
  return null;
}

export function checkRegisterProof(userId: string, publicKey: string, at: number, signature: string, nowMs: number): string | null {
  if (!isValidPublicKey(publicKey)) return "Нужен открытый ключ ECDSA P-256 в формате SPKI";
  if (Math.abs(nowMs - at) > SKEW_MS) return "Время запроса не совпадает с временем сервера";
  if (!verifyEs256(publicKey, registerMessage(userId, publicKey, at), signature)) return "Не удалось подтвердить владение ключом";
  return null;
}
