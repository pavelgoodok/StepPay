import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Токен входа: v2.<пользователь>.<время выдачи>.<подпись>. Живет 30 дней, и его можно отозвать:
 * пользователь может завершить все сессии, тогда токены, выданные раньше, перестают действовать.
 * Для адреса запроса (поток событий, закрытые файлы) выдается билет на 2 минуты: долгоживущий токен в ссылках не ходит.
 */
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const TICKET_TTL_MS = 2 * 60 * 1000;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const mac = (secret: string, kind: string, payload: string) => createHmac("sha256", `${secret}:${kind}`).update(payload).digest("base64url");

function seal(secret: string, kind: "v2" | "t", userId: string, at: number): string {
  const body = `${kind}.${b64(userId)}.${at}`;
  return `${body}.${mac(secret, kind, body)}`;
}

function open(secret: string, kind: "v2" | "t", token: string | undefined): { userId: string; at: number } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== kind) return null;
  const body = parts.slice(0, 3).join(".");
  const a = Buffer.from(parts[3]!);
  const b = Buffer.from(mac(secret, kind, body));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const at = Number(parts[2]);
  if (!Number.isFinite(at)) return null;
  return { userId: unb64(parts[1]!), at };
}

export const makeToken = (secret: string, userId: string, now: number) => seal(secret, "v2", userId, now);
export const makeTicket = (secret: string, userId: string, now: number) => seal(secret, "t", userId, now);

/** validAfter: момент, раньше которого выданные токены пользователя отозваны. */
export function verifyToken(secret: string, token: string | undefined, now: number, validAfter: (userId: string) => number = () => 0): string | null {
  const t = open(secret, "v2", token);
  if (!t || now - t.at > TOKEN_TTL_MS || t.at < 0 || t.at <= validAfter(t.userId)) return null;
  return t.userId;
}

export function verifyTicket(secret: string, ticket: string | undefined, now: number): string | null {
  const t = open(secret, "t", ticket);
  return t && now - t.at <= TICKET_TTL_MS && t.at <= now + 5000 ? t.userId : null;
}
