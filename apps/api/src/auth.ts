import { createHmac, timingSafeEqual } from "node:crypto";

const sign = (secret: string, id: string) => createHmac("sha256", secret).update(id).digest("base64url");

export const makeToken = (secret: string, userId: string) => `${userId}.${sign(secret, userId)}`;

export function verifyToken(secret: string, token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const id = token.slice(0, i);
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(sign(secret, id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}
