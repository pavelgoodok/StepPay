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
  /** passkey (WebAuthn) вместо ключа WebCrypto */
  kind?: "device" | "passkey";
  /** идентификатор учетных данных passkey, base64url */
  credentialId?: string;
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
export function checkSignProof(p: SignatureProof, want: ExpectedSign, nowMs?: number, origins?: string[]): string | null {
  const m = parse(p.message);
  if (!m || m.v !== 1 || m.kind !== "steppay.sign") return "Неверное сообщение подписи";
  if (m.dealId !== want.dealId || m.contract !== want.contract || m.userId !== want.userId) return "Подпись относится к другой сделке, другим условиям или другому пользователю";
  if (nowMs !== undefined && (typeof m.at !== "number" || Math.abs(nowMs - m.at) > SKEW_MS)) return "Время подписи не совпадает с временем сервера";
  if (p.keyId !== keyIdOf(p.publicKey)) return "Отпечаток не соответствует ключу";
  if (p.webauthn) return checkAssertion(p, origins);
  if (!verifyEs256(p.publicKey, p.message, p.signature)) return "Подпись не прошла проверку";
  return null;
}

// ───────────────────────── passkeys (WebAuthn) ─────────────────────────

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest();
const b64url = (buf: Buffer) => buf.toString("base64url");
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

/** Разбор clientDataJSON и проверка типа, challenge и адреса сайта. Возвращает адрес сайта или текст ошибки. */
function checkClientData(clientDataJSON: string, type: "webauthn.get" | "webauthn.create", challenge: string, origins?: string[]): { origin: string } | string {
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(clientDataJSON, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return "Не удалось разобрать данные браузера";
  }
  if (c.type !== type) return "Неверный тип запроса passkey";
  if (c.challenge !== challenge) return "Подпись passkey относится к другому запросу";
  if (typeof c.origin !== "string") return "Нет адреса сайта";
  if (c.crossOrigin === true) return "Запрос из чужого окна отклонен";
  if (origins && origins.length > 0 && !origins.includes(c.origin)) return "Passkey создан на другом сайте";
  return { origin: c.origin };
}

/** Проверка authenticatorData: хеш домена, присутствие пользователя и его проверка (отпечаток, лицо, PIN). */
function checkAuthData(authData: Buffer, origin: string, needAttested: boolean): string | null {
  if (authData.length < 37) return "Данные устройства неполные";
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return "Неверный адрес сайта";
  }
  if (!authData.subarray(0, 32).equals(sha256(host))) return "Passkey привязан к другому домену";
  const flags = authData[32]!;
  if (!(flags & FLAG_UP) || !(flags & FLAG_UV)) return "Нужно подтвердить действие отпечатком, лицом или PIN устройства";
  if (needAttested && !(flags & FLAG_AT)) return "В ответе нет данных нового ключа";
  return null;
}

/** Ответ passkey на запрос: тип, challenge, сайт, домен, подтверждение пользователя и подпись DER. */
function checkAssertionData(publicKey: string, a: { authenticatorData: string; clientDataJSON: string; signature: string }, challenge: string, origins?: string[]): string | null {
  const cd = checkClientData(a.clientDataJSON, "webauthn.get", challenge, origins);
  if (typeof cd === "string") return cd;
  const authData = Buffer.from(a.authenticatorData, "base64");
  const bad = checkAuthData(authData, cd.origin, false);
  if (bad) return bad;
  const key = importKey(publicKey);
  if (!key) return "Неверный ключ";
  try {
    const signed = Buffer.concat([authData, sha256(Buffer.from(a.clientDataJSON, "base64"))]);
    return verify("sha256", signed, key, Buffer.from(a.signature, "base64")) ? null : "Подпись passkey не прошла проверку";
  } catch {
    return "Подпись passkey не прошла проверку";
  }
}

/** Подпись под контрактом: challenge равен хешу нашего сообщения. */
function checkAssertion(p: SignatureProof, origins?: string[]): string | null {
  return checkAssertionData(p.publicKey, { ...p.webauthn!, signature: p.signature }, b64url(sha256(p.message)), origins);
}

/** Вход по passkey: challenge выдал сервер, в clientDataJSON он лежит как base64url от его текста. */
export function checkLoginAssertion(publicKey: string, a: { authenticatorData: string; clientDataJSON: string; signature: string }, challenge: string, origins?: string[]): string | null {
  return checkAssertionData(publicKey, a, b64url(Buffer.from(challenge, "utf8")), origins);
}

export interface PasskeyRegistration {
  credentialId: string;
  publicKey: string;
  authenticatorData: string;
  clientDataJSON: string;
  at: number;
}

/** Запрос регистрации passkey. Открытый ключ рождается уже после запроса, поэтому в challenge он не входит. */
export const passkeyMessage = (userId: string, at: number) => JSON.stringify({ v: 1, kind: "steppay.passkey", userId, at });

/** Регистрация passkey: challenge связан с пользователем и временем, данные устройства подтверждают домен и проверку пользователя. */
export function checkPasskeyRegistration(userId: string, r: PasskeyRegistration, nowMs: number, origins?: string[]): string | null {
  if (!isValidPublicKey(r.publicKey)) return "Нужен открытый ключ ECDSA P-256";
  if (Math.abs(nowMs - r.at) > SKEW_MS) return "Время запроса не совпадает с временем сервера";
  const cd = checkClientData(r.clientDataJSON, "webauthn.create", b64url(sha256(passkeyMessage(userId, r.at))), origins);
  if (typeof cd === "string") return cd;
  const authData = Buffer.from(r.authenticatorData, "base64");
  const bad = checkAuthData(authData, cd.origin, true);
  if (bad) return bad;
  // после 37 байт: aaguid (16), длина идентификатора (2), идентификатор
  if (authData.length < 55) return "Данные устройства неполные";
  const len = authData.readUInt16BE(53);
  const cred = authData.subarray(55, 55 + len);
  if (cred.length !== len || b64url(cred) !== r.credentialId) return "Идентификатор passkey не совпадает";
  return null;
}

export function checkRegisterProof(userId: string, publicKey: string, at: number, signature: string, nowMs: number): string | null {
  if (!isValidPublicKey(publicKey)) return "Нужен открытый ключ ECDSA P-256 в формате SPKI";
  if (Math.abs(nowMs - at) > SKEW_MS) return "Время запроса не совпадает с временем сервера";
  if (!verifyEs256(publicKey, registerMessage(userId, publicKey, at), signature)) return "Не удалось подтвердить владение ключом";
  return null;
}
