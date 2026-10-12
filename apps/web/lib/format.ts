/** 1234567 → «1 234 567» (неразрывные пробелы; русская локаль браузера не делит четырехзначные числа, поэтому считаем сами) */
export const group = (n: number | string) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");

/** копейки → «12 500 ₽», «5 000 ₽», копейки только если они есть: «1 250,5 ₽» */
export function rub(kopecks: number, opts: { sign?: boolean } = {}): string {
  const v = Math.round(kopecks) / 100;
  const [int, frac] = Math.abs(v).toFixed(2).split(".") as [string, string];
  const tail = frac === "00" ? "" : "," + frac.replace(/0$/, "");
  const sign = v < 0 ? "\u2212" : opts.sign && v > 0 ? "+" : "";
  return `${sign}${group(int)}${tail}\u00a0₽`;
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
