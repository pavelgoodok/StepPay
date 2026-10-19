import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export const NAVY = "#022872";
export const BLUE = "#0C40F6";
export const LAV = "#CAD6FD";
export const FONT = "Inter, 'Inter Display', 'Segoe UI', sans-serif";

export const Bg: React.FC<{ variant?: "blue" | "light" | "mix" }> = ({ variant = "blue" }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 6;
  const g =
    variant === "blue"
      ? `linear-gradient(${135 + drift}deg, #0A3FF6 0%, #0A3FF6 38%, #859FFB 70%, #FFFFFF 100%)`
      : variant === "light"
        ? `linear-gradient(${135 + drift}deg, #FFFFFF 0%, #9DB3FC 40%, #0A3FF6 100%)`
        : `linear-gradient(${150 + drift}deg, #0A3FF6 0%, #0A3FF6 50%, #5F82FB 80%, #CAD6FD 100%)`;
  return <AbsoluteFill style={{ background: g }} />;
};

/** Плавающая картинка: легкий дрейф и вращение. */
export const Glass: React.FC<{ src: string; x: number; y: number; w: number; rot?: number; delay?: number; amp?: number; opacity?: number }> = ({ src, x, y, w, rot = 0, delay = 0, amp = 14, opacity = 1 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 70 } });
  const dy = Math.sin((frame + delay * 3) / 38) * amp;
  const dr = Math.sin((frame + delay) / 70) * 4;
  return (
    <Img
      src={staticFile(src)}
      style={{ position: "absolute", left: x, top: y + dy + (1 - enter) * 120, width: w, opacity: enter * opacity, transform: `rotate(${rot + dr}deg) scale(${0.85 + enter * 0.15})`, filter: "drop-shadow(0 30px 50px rgba(2,40,114,.35))" }}
    />
  );
};

const MENU = ["ПРОБЛЕМАТИКА", "РЕШЕНИЕ", "АНАЛИЗ РЫНКА", "ТЕХНОЛОГИЯ", "ФИНАНСЫ", "ROADMAP"];
export const Menu: React.FC<{ active: number }> = ({ active }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame, fps, config: { damping: 20, stiffness: 120 } });
  return (
    <div style={{ position: "absolute", left: 60, top: 40, display: "flex", gap: 18, opacity: e, transform: `translateY(${(1 - e) * -30}px)` }}>
      {MENU.map((m, i) => (
        <div key={m} style={{ padding: "12px 26px", borderRadius: 14, background: i === active ? NAVY : LAV, color: i === active ? "#fff" : NAVY, fontFamily: FONT, fontWeight: 800, fontSize: 21, boxShadow: "0 6px 14px rgba(2,40,114,.35)" }}>
          {m}
        </div>
      ))}
    </div>
  );
};

/** Заголовок: слова выезжают по очереди. */
export const Title: React.FC<{ text: string; color?: string; size?: number; x?: number; y?: number; w?: number; delay?: number }> = ({ text, color = "#fff", size = 92, x = 60, y = 150, w = 1500, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, fontFamily: FONT, fontWeight: 900, fontSize: size, lineHeight: 1.02, color, letterSpacing: -1, display: "flex", flexWrap: "wrap", columnGap: size * 0.28 }}>
      {words.map((wd, i) => {
        const e = spring({ frame: frame - delay - i * 4, fps, config: { damping: 16, stiffness: 120 } });
        return (
          <span key={i} style={{ display: "inline-block", opacity: e, transform: `translateY(${(1 - e) * 50}px)` }}>
            {wd}
          </span>
        );
      })}
    </div>
  );
};

export const Card: React.FC<{ x: number; y: number; w: number; h: number; delay?: number; fill?: string; children?: React.ReactNode; radius?: number; from?: "up" | "left" | "right" }> = ({ x, y, w, h, delay = 0, fill = LAV, children, radius = 28, from = "up" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 110 } });
  const off = (1 - e) * 80;
  const tx = from === "left" ? -off : from === "right" ? off : 0;
  const ty = from === "up" ? off : 0;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: radius, background: fill, boxShadow: "0 14px 32px rgba(2,40,114,.38)", opacity: e, transform: `translate(${tx}px, ${ty}px) scale(${0.94 + e * 0.06})`, fontFamily: FONT, color: NAVY, boxSizing: "border-box", padding: "26px 34px" }}>
      {children}
    </div>
  );
};

export const Phone: React.FC<{ src: string; x: number; y: number; h: number; delay?: number; amp?: number }> = ({ src, x, y, h, delay = 0, amp = 10 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 80 } });
  const dy = Math.sin((frame + delay * 4) / 32) * amp;
  return (
    <Img src={staticFile(src)} style={{ position: "absolute", left: x, top: y + dy + (1 - e) * 500, height: h, opacity: Math.min(1, e * 1.4), transform: `scale(${0.9 + 0.1 * e})`, filter: "drop-shadow(0 40px 50px rgba(2,28,100,.45))" }} />
  );
};

export const Label: React.FC<{ text: string; x: number; y: number; w: number; delay?: number; size?: number; color?: string; weight?: number; align?: "left" | "center" }> = ({ text, x, y, w, delay = 0, size = 34, color = "#fff", weight = 700, align = "left" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 100 } });
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, fontFamily: FONT, fontWeight: weight, fontSize: size, color, opacity: e, transform: `translateY(${(1 - e) * 24}px)`, textAlign: align, lineHeight: 1.25 }}>{text}</div>
  );
};

export const Count: React.FC<{ to: number; from?: number; delay?: number; suffix?: string; format?: (n: number) => string }> = ({ to, from = 0, delay = 0, suffix = "", format }) => {
  const frame = useCurrentFrame();
  const v = interpolate(frame - delay, [0, 40], [from, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const n = Math.round(v);
  return <>{(format ? format(n) : n.toLocaleString("ru-RU")) + suffix}</>;
};
