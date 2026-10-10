/** копейки → «12 500 ₽» */
export function rub(kopecks: number, opts: { sign?: boolean } = {}): string {
  const v = Math.round(kopecks) / 100;
  const s = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Math.abs(v)).replace(/ | /g, " ");
  const sign = v < 0 ? "−" : opts.sign && v > 0 ? "+" : "";
  return `${sign}${s} ₽`;
}

export const toKopecks = (rubles: number) => Math.round(rubles * 100);

export function dayLabel(ts: number) {
  return new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function timeLeft(ms: number) {
  if (ms <= 0) return "сейчас";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `${Math.floor(h / 24)} дн. ${h % 24} ч`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}
