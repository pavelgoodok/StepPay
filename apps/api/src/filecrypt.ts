import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import type { StoredFile } from "./store";

/**
 * Шифрование закрытых файлов (документы проектов) в хранилище: AES-256-GCM, у каждого файла свой случайный IV,
 * идентификатор файла и владелец входят в проверяемые данные, поэтому зашифрованный файл нельзя подсунуть под другим
 * идентификатором или владельцем. Формат: "SPE1" + IV (12) + тег (16) + шифртекст. Ключ берется из FILE_KEY
 * (32 байта в hex или base64), без него выводится из AUTH_SECRET: тогда смена секрета делает файлы нечитаемыми.
 */
const MAGIC = Buffer.from("SPE1");

export function fileKeyFrom(secret: string, explicit?: string): Buffer {
  if (explicit) {
    const k = /^[0-9a-f]{64}$/i.test(explicit) ? Buffer.from(explicit, "hex") : Buffer.from(explicit, "base64");
    if (k.length !== 32) throw new Error("FILE_KEY должен быть 32 байта (64 символа hex или base64)");
    return k;
  }
  return Buffer.from(hkdfSync("sha256", secret, "steppay/files", "file-encryption-v1", 32));
}

const aad = (id: string, f: Pick<StoredFile, "ownerId" | "mime">) => Buffer.from(`${id}\n${f.ownerId ?? ""}\n${f.mime}`);

/** Закрытые файлы шифруются, открытые (аватары, обложки, фото) остаются как есть. */
export function sealFile(key: Buffer, id: string, f: StoredFile): StoredFile {
  if (!f.private) return f;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(aad(id, f));
  const body = Buffer.concat([c.update(f.data), c.final()]);
  return { ...f, data: Buffer.concat([MAGIC, iv, c.getAuthTag(), body]) };
}

/** Возвращает файл в открытом виде; null, если данные подменены или ключ не подходит. Старые файлы без шифрования отдаются как есть. */
export function openFile(key: Buffer, id: string, f: StoredFile): StoredFile | null {
  if (!f.private || !f.data.subarray(0, 4).equals(MAGIC)) return f;
  try {
    const iv = f.data.subarray(4, 16);
    const tag = f.data.subarray(16, 32);
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(aad(id, f));
    d.setAuthTag(tag);
    return { ...f, data: Buffer.concat([d.update(f.data.subarray(32)), d.final()]) };
  } catch {
    return null;
  }
}
