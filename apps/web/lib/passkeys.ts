import { api } from "./api";

/**
 * Passkey (WebAuthn): закрытый ключ лежит в защищенном чипе устройства или в связке ключей (iCloud, Google),
 * использовать его можно только после отпечатка, лица или PIN. Скрипты страницы и расширения до ключа не доберутся.
 * На сервер уходит открытый ключ и подтверждения устройства.
 */

export interface PasskeyInfo {
  id: string;
  kind: "device" | "passkey";
  credentialId?: string;
  active: boolean;
}

export interface PasskeyProof {
  keyId: string;
  message: string;
  signature: string;
  webauthn: { authenticatorData: string; clientDataJSON: string };
}

export const passkeysAvailable = () => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials && window.isSecureContext;

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64url = (buf: ArrayBuffer) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const sha256 = (text: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));

const keyIdOf = async (spkiB64: string) => {
  const h = await crypto.subtle.digest("SHA-256", Uint8Array.from(atob(spkiB64), (c) => c.charCodeAt(0)));
  return Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
};

const asMessage = (e: unknown) => {
  const n = (e as { name?: string })?.name;
  if (n === "NotAllowedError") return "Подтверждение отменено или не удалось. Попробуйте еще раз.";
  if (n === "InvalidStateError") return "Этот passkey уже есть на устройстве";
  return (e as Error)?.message || "Не удалось выполнить действие с passkey";
};

/** Создает passkey на устройстве и регистрирует открытую часть на сервере. */
export async function createPasskey(userId: string, name: string, label = "Passkey"): Promise<string> {
  try {
    const at = Date.now();
    const challenge = await sha256(JSON.stringify({ v: 1, kind: "steppay.passkey", userId, at }));
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "StepPay", id: location.hostname },
        user: { id: new TextEncoder().encode(userId), name, displayName: name },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        attestation: "none",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new Error("Passkey не создан");
    const r = cred.response as AuthenticatorAttestationResponse;
    const spki = r.getPublicKey?.();
    const authData = r.getAuthenticatorData?.();
    if (!spki || !authData) throw new Error("Этот браузер не отдает открытый ключ passkey. Обновите браузер.");
    const res = await api<{ id: string }>("/me/passkeys", {
      method: "POST",
      body: { credentialId: b64url(cred.rawId), publicKey: b64(spki), authenticatorData: b64(authData), clientDataJSON: b64(r.clientDataJSON), at, label },
    });
    return res.id;
  } catch (e) {
    throw new Error(asMessage(e));
  }
}

/** Подписывает сообщение passkey: challenge равен хешу сообщения, подтверждение отпечатком или лицом. */
export async function signWithPasskey(keys: { id: string; credentialId: string }[], message: string): Promise<PasskeyProof> {
  try {
    const a = (await navigator.credentials.get({
      publicKey: {
        challenge: await sha256(message),
        rpId: location.hostname,
        allowCredentials: keys.map((k) => ({ type: "public-key" as const, id: fromB64url(k.credentialId) })),
        userVerification: "required",
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!a) throw new Error("Подтверждение не получено");
    const r = a.response as AuthenticatorAssertionResponse;
    const key = keys.find((k) => k.credentialId === b64url(a.rawId));
    if (!key) throw new Error("Устройство выбрало неизвестный passkey");
    return { keyId: key.id, message, signature: b64(r.signature), webauthn: { authenticatorData: b64(r.authenticatorData), clientDataJSON: b64(r.clientDataJSON) } };
  } catch (e) {
    throw new Error(asMessage(e));
  }
}

/** Вход по passkey без кода из СМС: пользователя определяет само устройство. Возвращает токен. */
export async function loginWithPasskey(): Promise<string> {
  try {
    const { challenge } = await api<{ challenge: string }>("/auth/passkey/challenge", { method: "POST", body: {} });
    const a = (await navigator.credentials.get({
      publicKey: { challenge: new TextEncoder().encode(challenge), rpId: location.hostname, userVerification: "required", timeout: 60_000 },
    })) as PublicKeyCredential | null;
    if (!a) throw new Error("Подтверждение не получено");
    const r = a.response as AuthenticatorAssertionResponse;
    if (!r.userHandle) throw new Error("Этот passkey не подходит для входа");
    const res = await api<{ token: string }>("/auth/passkey/login", {
      method: "POST",
      body: { challenge, credentialId: b64url(a.rawId), userHandle: b64(r.userHandle), authenticatorData: b64(r.authenticatorData), clientDataJSON: b64(r.clientDataJSON), signature: b64(r.signature) },
    });
    return res.token;
  } catch (e) {
    throw new Error(asMessage(e));
  }
}

/** Подпись DER (r и s как целые числа) в сырой формат r||s, который понимает WebCrypto. */
function derToRaw(der: Uint8Array): Uint8Array<ArrayBuffer> {
  let i = 2;
  if (der[1]! & 0x80) i += der[1]! & 0x7f;
  const read = () => {
    if (der[i++] !== 0x02) throw new Error("bad der");
    const len = der[i++]!;
    let v = der.slice(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = read();
  const s = read();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

/** Проверка подписи passkey на этом устройстве без участия сервера. */
export async function verifyPasskeyProofLocally(p: { keyId: string; publicKey: string; message: string; signature: string; webauthn: { authenticatorData: string; clientDataJSON: string } }): Promise<boolean> {
  try {
    if (p.keyId !== (await keyIdOf(p.publicKey))) return false;
    const cd = Uint8Array.from(atob(p.webauthn.clientDataJSON), (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(cd)) as { type: string; challenge: string };
    if (data.type !== "webauthn.get" || data.challenge !== b64url(await sha256(p.message))) return false;
    const auth = Uint8Array.from(atob(p.webauthn.authenticatorData), (c) => c.charCodeAt(0));
    const signed = new Uint8Array([...auth, ...new Uint8Array(await crypto.subtle.digest("SHA-256", cd))]);
    const key = await crypto.subtle.importKey("spki", Uint8Array.from(atob(p.publicKey), (c) => c.charCodeAt(0)), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(Uint8Array.from(atob(p.signature), (c) => c.charCodeAt(0))), signed);
  } catch {
    return false;
  }
}
