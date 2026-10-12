"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { rub } from "@/lib/format";

export const IMG = {
  card: "/3d/card.webp",
  terminal: "/3d/terminal.webp",
  receipt: "/3d/receipt.webp",
  safe: "/3d/safe.webp",
  wallet: "/3d/wallet.webp",
};

export function Logo({ className = "" }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="StepPay" className={`logo light ${className}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-dark.png" alt="StepPay" className={`logo dark ${className}`} />
    </>
  );
}

export function Sheet({ onClose, children }: { onClose(): void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="grab" />
        <button className="x" onClick={onClose} aria-label="Закрыть">
          <Icon name="x" size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

/** Сегменты этапов: заполненные = принятые, мерцающий = текущий */
export function StageBars({ done, total, working }: { done: number; total: number; working?: boolean }) {
  return (
    <div className="bars" aria-label={`Этапов принято ${done} из ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < done ? "done" : i === done && working ? "cur" : ""} />
      ))}
    </div>
  );
}

export function Ava({ name, size }: { name: string; size?: "sm" | "lg" }) {
  return <div className={`ava ${size ?? ""}`}>{initialsOf(name)}</div>;
}

function initialsOf(name: string) {
  return name
    .replace(/[«»"]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/** Этапы кружками: принятые закрашены, текущий обведен */
export function StageDots({ done, total, working }: { done: number; total: number; working?: boolean }) {
  return (
    <div className="dots" aria-label={`Этапов принято ${done} из ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`dot-i ${i < done ? "done" : i === done && working ? "cur" : ""}`}>
          {i < done ? <Icon name="check" size={12} /> : i + 1}
        </span>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange(v: boolean): void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Initials({ name }: { name: string }) {
  const t = name
    .replace(/[«»"]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return <div className="avatar">{t}</div>;
}

const P: Record<string, string> = {
  x: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  deals: "M11 17l2 2a1 1 0 1 0 3-3M14 14l2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4M21 3l1 11h-2M3 3L2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8",
  sprout: "M12 21v-8m0 0c0-4-3-6-7-6 0 4 3 6 7 6zm0 0c0-3 2-5 6-5 0 3-2 5-6 5z",
  wallet: "M4 7a2 2 0 012-2h11v3M4 7v10a2 2 0 002 2h13a1 1 0 001-1V9a1 1 0 00-1-1H6a2 2 0 01-2-2zM16 14h2",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  hammer: "M14 6l4 4M5 19l8-8M12 4l8 8-3 3-8-8z",
  crowd: "M9 11a3 3 0 100-6 3 3 0 000 6zm7 1a2.5 2.5 0 100-5M3 20a6 6 0 0112 0M16 14a5 5 0 015 5",
  award: "M12 14a6 6 0 100-12 6 6 0 000 12zM8.5 13.5L7 22l5-3 5 3-1.5-8.5",
  lock: "M7 11V8a5 5 0 0110 0v3M6 11h12v10H6z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  down: "M12 5v14M6 13l6 6 6-6",
  back: "M15 5l-7 7 7 7",
  clock: "M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z",
  swap: "M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  moon: "M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z",
  logout: "M10 5H5v14h5M14 8l4 4-4 4M18 12H9",
  bolt: "M13 2L5 14h6l-1 8 8-12h-6z",
  bath: "M4 12h16v2a5 5 0 01-5 5H9a5 5 0 01-5-5zM6 12V6a2 2 0 014 0M7 19l-1 2M17 19l1 2",
  kitchen: "M5 11h14v8H5zM8 11V8m4 3V6m4 5V8",
  laptop: "M5 6h14v10H5zM2 19h20",
  ring: "M12 21a6 6 0 100-12 6 6 0 000 12zM9 6l3-3 3 3",
  flag: "M5 21V4m0 0h12l-2 4 2 4H5",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 100-7 3.5 3.5 0 000 7z",
};

export function Icon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name] ?? P.check} />
    </svg>
  );
}

/** Сумма с плавным пересчетом; при росте вылетают «монеты» - деньги дошли. */
export function Money({ value, burst = true }: { value: number; burst?: boolean }) {
  const [shown, setShown] = useState(value);
  const [pop, setPop] = useState(0);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    if (value > start && burst) setPop((n) => n + 1);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1100);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(start + (value - start) * e));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, burst]);
  return (
    <span className="money mono">
      {rub(shown)}
      {pop > 0 && (
        <span key={pop} className="coins" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ ["--a" as string]: `${i * 36}deg`, ["--d" as string]: `${50 + (i % 3) * 18}px`, animationDelay: `${i * 20}ms` }} />
          ))}
        </span>
      )}
    </span>
  );
}
