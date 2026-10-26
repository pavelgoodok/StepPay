import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { Bg, FONT, NAVY } from "./ui";
import FRAMES from "./frames.json";

/**
 * Демо-ролик StepPay: 3D-телефон и ноутбук, интерфейс меняется прямо на экране устройства.
 * Рамки устройств лежат в public/frames с прозрачным экраном, углы экрана в frames.json;
 * экраны приложения натягиваются в окно перспективным преобразованием (matrix3d).
 */

type FrameKey = keyof typeof FRAMES;
type Cam = [number, number, number];
/** Шаг сценария: экран, надпись, пояснение и движение камеры (масштаб и сдвиг от центра устройства) от начала к концу шага. */
type Step = { src: string; caption: string; desc?: string; dur: number; amount?: number; from?: Cam; to?: Cam };

/** Перспективное преобразование прямоугольника w×h в четырехугольник (как в сборке макетов). */
function matrix3d(w: number, h: number, q: number[][]): string {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i]!;
    const [u, v] = q[i]!;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // метод Гаусса
  const n = 8;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!]; [b[c], b[p]] = [b[p]!, b[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = A[r]![c]! / A[c]![c]!;
      for (let j = c; j < n; j++) A[r]![j]! -= k * A[c]![j]!;
      b[r]! -= k * b[c]!;
    }
  }
  const h8 = b.map((v, i) => v / A[i]![i]!);
  const [a0, a1, a2, a3, a4, a5, a6, a7] = h8 as [number, number, number, number, number, number, number, number];
  return `matrix3d(${a0},${a3},0,${a6},${a1},${a4},0,${a7},0,0,1,0,${a2},${a5},0,1)`;
}

const PHONE_SHOT = { w: 1170, h: 2532 };
const LAPTOP_SHOT = { w: 2880, h: 1800 };

/** Размер экрана в пикселях снимка: ширина снимка, высота по пропорции окна устройства. */
function screenBox(key: FrameKey) {
  const q = FRAMES[key].quad;
  const d = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
  const qw = (d(q[0]!, q[1]!) + d(q[3]!, q[2]!)) / 2;
  const qh = (d(q[0]!, q[3]!) + d(q[1]!, q[2]!)) / 2;
  const shot = key === "laptop" ? LAPTOP_SHOT : PHONE_SHOT;
  return { w: shot.w, h: Math.max(shot.h, (shot.w * qh) / qw) };
}

/** Устройство с меняющимся интерфейсом: новый экран проявляется на месте прежнего. */
const Device: React.FC<{ frame: FrameKey; steps: Step[]; x: number; y: number; h: number; enterDelay?: number }> = ({ frame, steps, x, y, h, enterDelay = 0 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const meta = FRAMES[frame];
  const k = h / meta.h;
  const box = screenBox(frame);
  const q = meta.quad.map(([a, b]) => [a! * k, b! * k]);
  const e = spring({ frame: f - enterDelay, fps, config: { damping: 17, stiffness: 70 } });
  const dy = Math.sin(f / 36) * 10;
  const dr = Math.sin(f / 60) * 1.1;
  let t = 0;
  const starts = steps.map((s) => { const v = t; t += s.dur; return v; });
  const PUSH = 12;
  // камера: внутри шага плавно от from к to, на смене шага мягкий переход от прежнего положения
  const ci = Math.max(0, starts.findIndex((st, i) => f >= st && (starts[i + 1] === undefined || f < starts[i + 1]!)));
  const cs = steps[ci]!;
  const lerp = (a: Cam, b: Cam, p: number): Cam => [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p];
  const io = Easing.inOut(Easing.cubic);
  const local = f - starts[ci]!;
  let cam = lerp(cs.from ?? [1, 0, 0], cs.to ?? cs.from ?? [1, 0, 0], io(Math.min(1, Math.max(0, local / cs.dur))));
  if (ci > 0 && local < 26) { const pv = steps[ci - 1]!; cam = lerp(pv.to ?? pv.from ?? [1, 0, 0], cam, io(local / 26)); }
  return (
    <div style={{ position: "absolute", left: x, top: y, width: meta.w * k, height: h, opacity: Math.min(1, e * 1.5), transformOrigin: "50% 50%", transform: `translate(${cam[1]}px, ${(1 - e) * 600 + dy + cam[2]}px) rotate(${dr}deg) scale(${(0.92 + 0.08 * e) * cam[0]})`, filter: "drop-shadow(0 50px 60px rgba(2,24,90,.5))" }}>
      <div style={{ position: "absolute", left: 0, top: 0, width: box.w, height: box.h, transformOrigin: "0 0", transform: matrix3d(box.w, box.h, q), overflow: "hidden", background: "#0b1020" }}>
        {steps.map((s, i) => {
          const st = starts[i]!;
          if (f < st - 1 && i > 0) return null;
          const p = i === 0 ? 1 : interpolate(f, [st, st + PUSH], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
          const next = starts[i + 1];
          const out = next === undefined ? 0 : interpolate(f, [next, next + PUSH], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
          return (
            <Img key={s.src} src={staticFile(`demo/${s.src}.png`)} style={{ position: "absolute", left: 0, top: 0, width: box.w, height: box.h, objectFit: "fill", opacity: p, visibility: out >= 1 ? "hidden" : "visible" }} />
          );
        })}
      </div>
      <Img src={staticFile(`frames/${frame}.png`)} style={{ position: "absolute", left: 0, top: 0, width: meta.w * k, height: h }} />
      {meta.glare && <Img src={staticFile(`frames/${frame}_glare.png`)} style={{ position: "absolute", left: 0, top: 0, width: meta.w * k, height: h }} />}
    </div>
  );
};

/** Надписи по шагам: белые заглавные, слова появляются по очереди, прежняя надпись уходит вверх. */
const Captions: React.FC<{ steps: Step[]; x?: number; y?: number; w?: number; size?: number; center?: boolean }> = ({ steps, x = 100, y = 150, w = 760, size = 80, center = false }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  let t = 0;
  return (
    <>
      {steps.map((s, idx) => {
        const st = t; t += s.dur;
        const end = t;
        if (f < st - 2 || f > end + 12) return null;
        const outE = idx === steps.length - 1 ? 0 : interpolate(f, [end - 4, end + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const words = s.caption.split(" ");
        return (
          <div key={idx} style={{ position: "absolute", left: x, top: y, width: w, opacity: 1 - outE, transform: `translateY(${-outE * 40}px)` }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: center ? "center" : "flex-start", columnGap: size * 0.26, fontFamily: FONT, fontWeight: 900, fontSize: size, lineHeight: 1.04, color: "#fff", letterSpacing: -1, textTransform: "uppercase", textShadow: "0 4px 24px rgba(2,24,90,.5)" }}>
              {words.map((wd, i) => {
                const e = spring({ frame: f - st - 6 - i * 5, fps, config: { damping: 15, stiffness: 120 } });
                return (
                  <span key={i} style={{ display: "inline-block", overflow: "hidden" }}>
                    <span style={{ display: "inline-block", transform: `translateY(${(1 - e) * 100}%)`, opacity: e }}>{wd}</span>
                  </span>
                );
              })}
            </div>
            {s.desc && <Desc text={s.desc} delay={st + 16 + words.length * 5} size={Math.round(size * 0.42)} />}
            {s.amount !== undefined && <Amount to={s.amount} delay={st + 24} />}
          </div>
        );
      })}
    </>
  );
};

/** Пояснение под надписью: заглавные буквы помельче, появляется после надписи. */
const Desc: React.FC<{ text: string; delay: number; size: number }> = ({ text, delay, size }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: f - delay, fps, config: { damping: 18, stiffness: 110 } });
  return <div style={{ marginTop: 28, maxWidth: 640, fontFamily: FONT, fontWeight: 700, fontSize: size, lineHeight: 1.3, letterSpacing: 0.5, color: "rgba(255,255,255,.88)", textTransform: "uppercase", opacity: e, transform: `translateY(${(1 - e) * 24}px)`, textShadow: "0 2px 18px rgba(2,24,90,.45)" }}>{text}</div>;
};

const Amount: React.FC<{ to: number; delay: number }> = ({ to, delay }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: f - delay, fps, config: { damping: 18, stiffness: 100 } });
  const v = Math.round(interpolate(f, [delay, delay + 40], [0, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }));
  return <div style={{ marginTop: 40, fontFamily: FONT, fontWeight: 900, fontSize: 120, color: "#fff", letterSpacing: -3, opacity: e, transform: `translateY(${(1 - e) * 40}px)` }}>{v.toLocaleString("ru-RU").replace(/ /g, " ")} ₽</div>;
};

const sum = (s: Step[]) => s.reduce((a, b) => a + b.dur, 0);

/** Сцена: синий фон, надписи слева, устройство справа. */
const Stage: React.FC<{ device: FrameKey; steps: Step[]; variant?: "blue" | "mix" }> = ({ device, steps, variant = "blue" }) => {
  const laptop = device === "laptop";
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Bg variant={variant} />
      {!laptop && <Device frame={device} steps={steps} x={1120} y={30} h={1020} />}
      <Captions steps={steps} w={laptop ? 900 : 760} size={laptop ? 72 : 80} y={laptop ? 100 : 160} />
      {laptop && <Device frame="laptop" steps={steps} x={760} y={380} h={780} />}
    </AbsoluteFill>
  );
};

/* ───── сценарий ───── */
const CUSTOMER_1: Step[] = [
  { src: "m01_catalog", caption: "Заказчик находит исполнителя", desc: "Каталог услуг с рейтингом и проверенными исполнителями", dur: 100, from: [1, 0, 30], to: [1.3, -40, 220] },
  { src: "m02_chat", caption: "Договорились в чате", desc: "Исполнитель регистрирует задачу на 280 000 ₽", dur: 100, from: [1.55, -30, 330], to: [1.7, -40, 120] },
];
const EXECUTOR_1: Step[] = [{ src: "m03_terms", caption: "Этапы, суммы и неустойка", desc: "Три этапа с критериями приемки, неустойка 0,5 % в сутки", dur: 120, from: [1.15, 0, 330], to: [1.75, -40, -160] }];
const CUSTOMER_2: Step[] = [
  { src: "m04_review", caption: "Контракт подписан", desc: "Хеш условий записан, изменить их нельзя", dur: 95, from: [1.1, 0, 80], to: [1.55, -20, 300] },
  { src: "m06_reserved", caption: "Вся сумма в резерве", desc: "Деньги в эскроу-кошельке сделки", dur: 105, amount: 280000, from: [1.7, 0, 470], to: [1.85, -10, 420] },
];
const CUSTOMER_3: Step[] = [
  { src: "m07_submitted", caption: "Этап сдан", desc: "Исполнитель прикладывает результат, заказчик проверяет", dur: 95, from: [1.3, 0, -60], to: [1.65, 0, -330] },
  { src: "m08_progress", caption: "Этап принят и оплачен", desc: "110 000 ₽ сразу переведены исполнителю", dur: 95, from: [1.7, 0, -260], to: [1.35, 0, 20] },
  { src: "m09_journal", caption: "Журнал без изменений", desc: "Каждое действие записано в цепочку хешей", dur: 90, from: [1.2, 0, 160], to: [1.55, 0, 260] },
];
const EXECUTOR_2: Step[] = [
  { src: "m10_wallet", caption: "Оплата получена", desc: "Выплата сразу в кошельке исполнителя", dur: 100, amount: 110000, from: [1, 0, 0], to: [1.7, 0, 430] },
  { src: "m11_deals", caption: "Остаток ждет следующих этапов", desc: "170 000 ₽ в резерве до приемки", dur: 95, from: [1.6, 0, 300], to: [1.2, 0, 0] },
];
const ADMIN: Step[] = [
  { src: "a01_dashboard", caption: "Панель администратора", desc: "Резервы, выплаты и споры на одном экране", dur: 100, from: [1, 0, 0], to: [1.4, 200, 230] },
  { src: "a02_transactions", caption: "Операции участников", desc: "Каждый резерв, выплата и неустойка", dur: 95, from: [1.5, 260, 260], to: [1.6, 200, 280] },
  { src: "a05_projects", caption: "Проверка проектов", desc: "Проекты публикуются после модерации", dur: 90, from: [1.45, 230, 250], to: [1, 0, 0] },
];

/* ───── заставка и финал: логотип ───── */
const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const burst = interpolate(f, [0, 28], [0, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const card = spring({ frame: f - 8, fps, config: { damping: 11, stiffness: 140 } });
  const logo = spring({ frame: f - 18, fps, config: { damping: 14, stiffness: 120 } });
  const shine = interpolate(f, [30, 62], [-40, 140], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Bg variant="blue" />
      <div style={{ position: "absolute", left: 960 - 700 * burst, top: 470 - 700 * burst, width: 1400 * burst, height: 1400 * burst, borderRadius: "50%", border: `${6 * (1 - burst) + 1}px solid rgba(255,255,255,${0.6 * (1 - burst)})` }} />
      <div style={{ position: "absolute", left: 960 - 330, top: 330, width: 660, height: 280, borderRadius: 40, background: "#fff", display: "grid", placeItems: "center", overflow: "hidden", boxShadow: "0 40px 80px rgba(2,28,100,.45)", transform: `scale(${card}) rotate(${(1 - card) * -8}deg)`, opacity: Math.min(1, card * 2) }}>
        <Img src={staticFile("img/logo.png")} style={{ width: 520, opacity: logo, transform: `translateY(${(1 - logo) * 40}px)` }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${shine}%`, width: 120, background: "linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent)", transform: "skewX(-20deg)" }} />
      </div>
      <Captions steps={[{ src: "", caption: "Оплата работ по этапам", dur: 999 }]} x={0} y={680} w={1920} size={64} center />
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const card = spring({ frame: f - 4, fps, config: { damping: 13, stiffness: 120 } });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Bg variant="blue" />
      <div style={{ position: "absolute", left: 960 - 300, top: 250, width: 600, height: 250, borderRadius: 36, background: "#fff", display: "grid", placeItems: "center", boxShadow: "0 40px 80px rgba(2,28,100,.45)", transform: `scale(${card})` }}>
        <Img src={staticFile("img/logo.png")} style={{ width: 470 }} />
      </div>
      <Captions steps={[{ src: "", caption: "Деньги движутся только за принятый результат", dur: 999 }]} x={260} y={580} w={1400} size={70} center />
    </AbsoluteFill>
  );
};

const T = 16;
const SCENES: { C: React.FC; dur: number }[] = [
  { C: Intro, dur: 110 },
  { C: () => <Stage device="phone" steps={CUSTOMER_1} />, dur: sum(CUSTOMER_1) },
  { C: () => <Stage device="phone_r" steps={EXECUTOR_1} variant="mix" />, dur: sum(EXECUTOR_1) },
  { C: () => <Stage device="phone" steps={CUSTOMER_2} />, dur: sum(CUSTOMER_2) },
  { C: () => <Stage device="phone_r" steps={CUSTOMER_3} variant="mix" />, dur: sum(CUSTOMER_3) },
  { C: () => <Stage device="phone" steps={EXECUTOR_2} />, dur: sum(EXECUTOR_2) },
  { C: () => <Stage device="laptop" steps={ADMIN} variant="mix" />, dur: sum(ADMIN) },
  { C: Outro, dur: 110 },
];
export const DEMO_FRAMES = SCENES.reduce((a, s) => a + s.dur, 0) - T * (SCENES.length - 1);

export const StepPayDemo: React.FC = () => (
  <AbsoluteFill style={{ background: NAVY }}>
    <TransitionSeries>
      {SCENES.map(({ C, dur }, i) => (
        <React.Fragment key={i}>
          <TransitionSeries.Sequence durationInFrames={dur}>
            <C />
          </TransitionSeries.Sequence>
          {i < SCENES.length - 1 && <TransitionSeries.Transition presentation={i === 0 || i === SCENES.length - 2 ? fade() : slide({ direction: i % 2 ? "from-right" : "from-bottom" })} timing={linearTiming({ durationInFrames: T })} />}
        </React.Fragment>
      ))}
    </TransitionSeries>
  </AbsoluteFill>
);
