import { createHash, randomInt } from "node:crypto";

interface Entry {
  hash: string;
  expiresAt: number;
  attempts: number;
  /** время выдачи кодов за последний час: ограничивает частоту запросов */
  sent: number[];
}

/** Где лежат коды: в базе, чтобы подтверждение работало на любом экземпляре API. */
export interface OtpStorage {
  otpGet(key: string): Promise<unknown>;
  otpSet(key: string, value: unknown): Promise<void>;
  otpDel(key: string): Promise<void>;
}

/** Способ доставки кода. Сейчас демо: код возвращается в ответе. Для боя подставьте SMS или Telegram Gateway. */
export interface OtpDelivery {
  /** true, если код нужно показать на экране (демо) */
  readonly showsCode: boolean;
  send(phone: string, code: string): Promise<void>;
}

export const demoDelivery: OtpDelivery = { showsCode: true, async send() {} };

const TTL = 5 * 60_000;
const RESEND_AFTER = 30_000;
const MAX_ATTEMPTS = 5;
const MAX_PER_HOUR = 6;

export class OtpService {
  private mem = new Map<string, Entry>();
  private storage: OtpStorage = {
    otpGet: async (k) => this.mem.get(k),
    otpSet: async (k, v) => void this.mem.set(k, v as Entry),
    otpDel: async (k) => void this.mem.delete(k),
  };

  constructor(
    private secret: string,
    private delivery: OtpDelivery = demoDelivery,
    private now: () => number = Date.now,
    storage?: OtpStorage,
  ) {
    if (storage) this.storage = storage;
  }

  private hash(phone: string, code: string) {
    return createHash("sha256").update(`${this.secret}:${phone}:${code}`).digest("hex");
  }
  /** В базе телефон не хранится открытым: ключом служит его хеш. */
  private key(phone: string) {
    return createHash("sha256").update(`${this.secret}:otp:${phone}`).digest("hex");
  }

  /** Возвращает демо-код (если доставка демо) или null. Бросает Error с понятным текстом при превышении лимитов. */
  async request(phone: string): Promise<{ demoCode: string | null; retryAfter: number }> {
    const t = this.now();
    const k = this.key(phone);
    const prev = (await this.storage.otpGet(k)) as Entry | undefined;
    const history = (prev?.sent ?? []).filter((x) => t - x < 3_600_000);
    const last = history[history.length - 1];
    if (last && t - last < RESEND_AFTER) throw new Error(`Повторный код можно запросить через ${Math.ceil((RESEND_AFTER - (t - last)) / 1000)} с`);
    if (history.length >= MAX_PER_HOUR) throw new Error("Слишком много запросов кода, попробуйте позже");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.storage.otpSet(k, { hash: this.hash(phone, code), expiresAt: t + TTL, attempts: 0, sent: [...history, t] } satisfies Entry);
    await this.delivery.send(phone, code);
    return { demoCode: this.delivery.showsCode ? code : null, retryAfter: RESEND_AFTER / 1000 };
  }

  async verify(phone: string, code: string): Promise<boolean> {
    const k = this.key(phone);
    const e = (await this.storage.otpGet(k)) as Entry | undefined;
    if (!e || this.now() > e.expiresAt) throw new Error("Код устарел, запросите новый");
    if (e.attempts >= MAX_ATTEMPTS) throw new Error("Слишком много попыток, запросите новый код");
    e.attempts++;
    if (e.hash !== this.hash(phone, code.trim())) {
      await this.storage.otpSet(k, e);
      return false;
    }
    // история запросов сохраняется, чтобы ограничение по частоте не обходилось подтверждением
    await this.storage.otpSet(k, { ...e, expiresAt: 0, attempts: MAX_ATTEMPTS });
    return true;
  }
}
