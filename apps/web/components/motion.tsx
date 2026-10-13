"use client";
import { useEffect, useRef, useState } from "react";

/** Возвращает true на 1,6 секунды после того, как значение изменилось (первый показ не считается). Нужен для подсветки обновлений. */
export function useChangeFlash(key: unknown, ms = 1600): boolean {
  const prev = useRef(key);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (prev.current === key) return;
    prev.current = key;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return on;
}

/** Какие из элементов сменили значение с прошлого показа: id попадают в набор на ms миллисекунд. Первый показ не считается. */
export function useChangedIds(values: Record<string, string>, ms = 1400): Set<string> {
  const prev = useRef<Record<string, string> | null>(null);
  const [ids, setIds] = useState<Set<string>>(new Set());
  const sig = JSON.stringify(values);
  useEffect(() => {
    const before = prev.current;
    prev.current = values;
    if (!before) return;
    const changed = Object.keys(values).filter((k) => before[k] !== undefined && before[k] !== values[k]);
    if (changed.length === 0) return;
    setIds(new Set(changed));
    const t = setTimeout(() => setIds(new Set()), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ms]);
  return ids;
}

/** Рисованная галочка: контур дорисовывается. */
export function Tick({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
