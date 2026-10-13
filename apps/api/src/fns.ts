import type { AuthorProfile } from "./users";

/**
 * Сверка анкеты автора с открытыми сервисами ФНС России:
 * - самозанятый: «Проверка статуса налогоплательщика НПД» (statusnpd.nalog.ru);
 * - ИП и организация: выписка ЕГРИП и ЕГРЮЛ (egrul.nalog.ru): ИНН найден, деятельность не прекращена, вид совпадает, название похоже на указанное;
 * - физическое лицо: реестра нет, остается проверка контрольных цифр.
 * Сервисы ФНС могут быть недоступны или потребовать капчу: тогда результат «не удалось проверить», решение остается за администратором.
 */
export type FnsStatus = "match" | "mismatch" | "unavailable" | "none";

export interface FnsCheck {
  status: FnsStatus;
  checkedAt: number;
  source: string;
  /** как зарегистрирован по данным ФНС */
  name?: string;
  detail: string;
}

type Fetch = typeof fetch;
const TIMEOUT = 8000;

const unavailable = (now: number, source: string, why: string): FnsCheck => ({ status: "unavailable", checkedAt: now, source, detail: `Не удалось проверить: ${why}. Проверьте вручную на сайте ФНС.` });

/** Сравнение названий: без кавычек, организационных форм и знаков, совпадение любого значимого слова. */
export function similarNames(a: string, b: string): boolean {
  const words = (x: string) =>
    x
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/["«»'.,()\-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !["ооо", "оао", "зао", "пао", "ао", "нко", "индивидуальный", "предприниматель", "общество", "ограниченной", "ответственностью", "акционерное", "публичное"].includes(w));
  const wa = words(a);
  const wb = new Set(words(b));
  return wa.length > 0 && wa.some((w) => wb.has(w));
}

async function selfEmployed(inn: string, now: number, f: Fetch): Promise<FnsCheck> {
  const source = "ФНС, статус плательщика НПД";
  try {
    const r = await f("https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inn, requestDate: new Date(now).toISOString().slice(0, 10) }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!r.ok) return unavailable(now, source, `сервис ответил ${r.status}`);
    const j = (await r.json()) as { status?: boolean; message?: string };
    if (typeof j.status !== "boolean") return unavailable(now, source, "неожиданный ответ сервиса");
    return j.status
      ? { status: "match", checkedAt: now, source, detail: "ФНС подтверждает: плательщик налога на профессиональный доход" }
      : { status: "mismatch", checkedAt: now, source, detail: `ФНС не подтверждает статус самозанятого${j.message ? `: ${j.message}` : ""}` };
  } catch (e) {
    return unavailable(now, source, (e as Error).name === "TimeoutError" ? "сервис не ответил вовремя" : "нет связи с сервисом");
  }
}

interface EgrulRow {
  i?: string; // ИНН
  n?: string; // название
  k?: string; // ul или fl (ИП)
  e?: string; // дата прекращения
  g?: string; // руководитель
}

async function egrul(a: AuthorProfile, now: number, f: Fetch): Promise<FnsCheck> {
  const source = "ФНС, ЕГРЮЛ и ЕГРИП";
  try {
    const form = new URLSearchParams({ vyp3CaptchaToken: "", page: "", query: a.inn, region: "", PreventChromeAutocomplete: "" });
    const start = await f("https://egrul.nalog.ru/", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(TIMEOUT) });
    if (!start.ok) return unavailable(now, source, `сервис ответил ${start.status}`);
    const s = (await start.json()) as { t?: string; captchaRequired?: boolean };
    if (s.captchaRequired) return unavailable(now, source, "ФНС просит ввести капчу");
    if (!s.t) return unavailable(now, source, "неожиданный ответ сервиса");
    const res = await f(`https://egrul.nalog.ru/search-result/${encodeURIComponent(s.t)}`, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return unavailable(now, source, `сервис ответил ${res.status}`);
    const j = (await res.json()) as { rows?: EgrulRow[] };
    const rows = (j.rows ?? []).filter((r) => r.i === a.inn);
    if (rows.length === 0) return { status: "mismatch", checkedAt: now, source, detail: "ИНН не найден в ЕГРЮЛ и ЕГРИП" };
    const row = rows[0]!;
    const isIp = row.k === "fl";
    if (a.legalStatus === "ip" && !isIp) return { status: "mismatch", checkedAt: now, source, name: row.n, detail: "Этот ИНН принадлежит организации, а не индивидуальному предпринимателю" };
    if (a.legalStatus === "org" && isIp) return { status: "mismatch", checkedAt: now, source, name: row.n, detail: "Этот ИНН принадлежит индивидуальному предпринимателю, а не организации" };
    if (row.e) return { status: "mismatch", checkedAt: now, source, name: row.n, detail: `Деятельность прекращена ${row.e}` };
    if (a.orgName && row.n && !similarNames(a.orgName, row.n)) return { status: "mismatch", checkedAt: now, source, name: row.n, detail: `В реестре записано «${row.n}», в анкете «${a.orgName}»` };
    return { status: "match", checkedAt: now, source, name: row.n, detail: `Найден в реестре, действует${row.n ? `: ${row.n}` : ""}` };
  } catch (e) {
    return unavailable(now, source, (e as Error).name === "TimeoutError" ? "сервис не ответил вовремя" : "нет связи с сервисом");
  }
}

export async function checkWithFns(a: AuthorProfile, now: number, f: Fetch = fetch): Promise<FnsCheck> {
  if (a.legalStatus === "person") return { status: "none", checkedAt: now, source: "Контрольные цифры ИНН", detail: "Для физического лица в ФНС нет открытого реестра: проверены только контрольные цифры" };
  if (a.legalStatus === "selfemployed") return selfEmployed(a.inn, now, f);
  return egrul(a, now, f);
}
