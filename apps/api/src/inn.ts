/** Проверка ИНН по контрольным цифрам: 10 знаков у организаций, 12 у физлиц и ИП. */
const W10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const W11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const W12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

const control = (d: number[], w: number[]) => (w.reduce((a, k, i) => a + k * d[i]!, 0) % 11) % 10;

export function validInn(raw: string): boolean {
  if (!/^\d{10}$|^\d{12}$/.test(raw)) return false;
  const d = [...raw].map(Number);
  if (d.length === 10) return control(d, W10) === d[9];
  return control(d, W11) === d[10] && control(d, W12) === d[11];
}

/** Достраивает 9 цифр до корректного 10-значного ИНН (для демо-данных). */
export const innFromNine = (nine: string) => nine + String(control([...nine].map(Number), W10));
