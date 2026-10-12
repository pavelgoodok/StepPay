import { api } from "./api";

/**
 * Ключ подписи на устройстве: ECDSA P-256 через WebCrypto. Закрытый ключ создается без права экспорта
 * и хранится в IndexedDB этого браузера, наружу не уходит. На сервер отправляется только открытый ключ.
 */

export interface StoredKey {
  userId: string;
  id: string;
  publicKey: string;
  privateKey: CryptoKey;
  label: string;
  createdAt: number;
}

export interface Proof {
  keyId: string;
  message: string;
  signature: string;
}

export const deviceKeysAvailable = () => typeof window !== "undefined" && !!window.crypto?.subtle && typeof indexedDB !== "undefined";

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

function db(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open("steppay-keys", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys", { keyPath: "userId" });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((ok, no) => {
    const req = fn(d.transaction("keys", mode).objectStore("keys"));
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });
}

export const getStoredKey = (userId: string) => tx<StoredKey | undefined>("readonly", (s) => s.get(userId)).then((k) => k ?? null);
export const forgetStoredKey = (userId: string) => tx("readwrite", (s) => s.delete(userId)).then(() => undefined);

const keyIdOf = async (publicKey: string) => {
  const h = await crypto.subtle.digest("SHA-256", unb64(publicKey));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
};

async function sign(key: CryptoKey, text: string) {
  return b64(await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(text)));
}

/** Создает ключ на этом устройстве и регистрирует открытую часть на сервере. */
export async function createDeviceKey(userId: string, label = `Ключ от ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "short" })}`): Promise<StoredKey> {
  const pair = await crypto.subtle.generateKey(ALG, false, ["sign", "verify"]);
  const publicKey = b64(await crypto.subtle.exportKey("spki", pair.publicKey));
  const id = await keyIdOf(publicKey);
  const at = Date.now();
  const message = JSON.stringify({ v: 1, kind: "steppay.register", userId, keyId: id, at });
  await api("/me/keys", { method: "POST", body: { publicKey, label, at, signature: await sign(pair.privateKey, message) } });
  const stored: StoredKey = { userId, id, publicKey, privateKey: pair.privateKey, label, createdAt: at };
  await tx("readwrite", (s) => s.put(stored));
  return stored;
}

/** Ключ этого устройства, действующий на сервере; если его нет, создает новый. */
export async function ensureDeviceKey(userId: string): Promise<StoredKey> {
  const have = await getStoredKey(userId);
  if (have) {
    const list = await api<{ id: string; active: boolean }[]>("/me/keys");
    if (list.some((k) => k.id === have.id && k.active)) return have;
    await forgetStoredKey(userId);
  }
  return createDeviceKey(userId);
}

/** Подписывает условия контракта: сделка, хеш условий, подписант и время. */
export async function signContractOnDevice(userId: string, dealId: string, contract: string): Promise<Proof> {
  const key = await ensureDeviceKey(userId);
  const message = JSON.stringify({ v: 1, kind: "steppay.sign", dealId, contract, userId, at: Date.now() });
  return { keyId: key.id, message, signature: await sign(key.privateKey, message) };
}

export interface ProofData extends Proof {
  alg: "ES256";
  publicKey: string;
}

/** Проверка подписи на этом устройстве без участия сервера. */
export async function verifyProofLocally(p: ProofData, want: { dealId: string; contract: string; userId: string }): Promise<boolean> {
  try {
    const m = JSON.parse(p.message) as Record<string, unknown>;
    if (m.kind !== "steppay.sign" || m.dealId !== want.dealId || m.contract !== want.contract || m.userId !== want.userId) return false;
    if (p.keyId !== (await keyIdOf(p.publicKey))) return false;
    const key = await crypto.subtle.importKey("spki", unb64(p.publicKey), ALG, false, ["verify"]);
    return await crypto.subtle.verify(SIGN, key, unb64(p.signature), new TextEncoder().encode(p.message));
  } catch {
    return false;
  }
}
