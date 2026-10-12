import { createHash, randomInt } from "node:crypto";

interface Entry {
  hash: string;
  expiresAt: number;
  attempts: number;
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
  private codes = new Map<string, Entry>();
  private sent = new Map<string, number[]>();

  constructor(
    private secret: string,
    private delivery: OtpDelivery = demoDelivery,
    private now: () => number = Date.now,
  ) {}

  private hash(phone: string, code: string) {
    return createHash("sha256").update(`${this.secret}:${phone}:${code}`).digest("hex");
  }

  /** Возвращает демо-код (если доставка демо) или null. Бросает Error с понятным текстом при превышении лимитов. */
  async request(phone: string): Promise<{ demoCode: string | null; retryAfter: number }> {
    const t = this.now();
    const history = (this.sent.get(phone) ?? []).filter((x) => t - x < 3_600_000);
    const last = history[history.length - 1];
    if (last && t - last < RESEND_AFTER) throw new Error(`Повторный код можно запросить через ${Math.ceil((RESEND_AFTER - (t - last)) / 1000)} с`);
    if (history.length >= MAX_PER_HOUR) throw new Error("Слишком много запросов кода, попробуйте позже");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.codes.set(phone, { hash: this.hash(phone, code), expiresAt: t + TTL, attempts: 0 });
    this.sent.set(phone, [...history, t]);
    await this.delivery.send(phone, code);
    return { demoCode: this.delivery.showsCode ? code : null, retryAfter: RESEND_AFTER / 1000 };
  }

  verify(phone: string, code: string): boolean {
    const e = this.codes.get(phone);
    if (!e || this.now() > e.expiresAt) throw new Error("Код устарел, запросите новый");
    if (e.attempts >= MAX_ATTEMPTS) throw new Error("Слишком много попыток, запросите новый код");
    e.attempts++;
    if (e.hash !== this.hash(phone, code.trim())) return false;
    this.codes.delete(phone);
    return true;
  }
}
