import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";

/** Демо-ролик StepPay: сценарий сделки на реальных экранах приложения и панель администратора. Технологичный стиль: сетка, моноширинные подписи, тонкие линии. */

const BG = "#050A18";
const LINE = "rgba(120,150,255,.12)";
const ACC = "#3D7BFF";
const CYAN = "#5CE1FF";
const GREEN = "#2FD57E";
const AMBER = "#FFB547";
const TXT = "#E8EEFF";
const DIM = "#7F8BB0";
const SANS = "Inter, 'Inter Display', sans-serif";
const MONO = "'DejaVu Sans Mono', 'JetBrains Mono', monospace";

const T = 15;
const SCENES = [96, 108, 108, 126, 120, 120, 156, 114, 114, 228, 108];
export const DEMO_FRAMES = SCENES.reduce((a, b) => a + b, 0) - T * (SCENES.length - 1);

const ease = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.2, 0.8, 0.2, 1) });

/** Фон: сетка, медленный дрейф, световое пятно. */
const Grid: React.FC<{ glow?: string }> = ({ glow = ACC }) => {
  const f = useCurrentFrame();
  const off = (f * 0.6) % 60;
  return (
    <AbsoluteFill style={{ background: BG }}>
      <AbsoluteFill style={{ backgroundImage: `linear-gradient(${LINE} 1px, transparent 1px), linear-gradient(90deg, ${LINE} 1px, transparent 1px)`, backgroundSize: "60px 60px", backgroundPosition: `${off}px ${off}px` }} />
      <AbsoluteFill style={{ background: `radial-gradient(900px 600px at 72% 50%, ${glow}33, transparent 70%)` }} />
      <AbsoluteFill style={{ background: `radial-gradient(700px 500px at 10% 100%, ${CYAN}14, transparent 70%)` }} />
    </AbsoluteFill>
  );
};

/** Верхняя служебная строка: шаг сценария и прогресс. */
const Hud: React.FC<{ step: number; total: number; label: string }> = ({ step, total, label }) => {
  const f = useCurrentFrame();
  const e = ease(f, 0, 18);
  return (
    <div style={{ position: "absolute", left: 90, right: 90, top: 56, display: "flex", alignItems: "center", gap: 22, fontFamily: MONO, fontSize: 20, color: DIM, opacity: e }}>
      <span style={{ color: CYAN }}>STEPPAY / DEMO</span>
      <span>{String(step).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>
      <span style={{ color: TXT }}>{label}</span>
      <div style={{ flex: 1, height: 2, background: "rgba(255,255,255,.08)", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: 2, width: `${(step / total) * 100 * e}%`, background: `linear-gradient(90deg, ${ACC}, ${CYAN})` }} />
      </div>
    </div>
  );
};

/** Текстовый блок сцены: номер, заголовок, пояснение, плашки с данными. */
const Copy: React.FC<{ n: string; title: string; text: string; chips?: { k: string; v: string; c?: string }[]; x?: number; w?: number }> = ({ n, title, text, chips = [], x = 90, w = 760 }) => {
  const f = useCurrentFrame();
  const a = ease(f, 6, 26), b = ease(f, 14, 36);
  return (
    <div style={{ position: "absolute", left: x, top: 250, width: w, fontFamily: SANS, color: TXT }}>
      <div style={{ fontFamily: MONO, fontSize: 26, color: CYAN, opacity: a, letterSpacing: 2 }}>{n}</div>
      <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.04, letterSpacing: -2, marginTop: 14, opacity: a, transform: `translateY(${(1 - a) * 30}px)` }}>{title}</div>
      <div style={{ fontSize: 32, lineHeight: 1.35, color: "#B7C2E6", marginTop: 26, opacity: b, transform: `translateY(${(1 - b) * 20}px)` }}>{text}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 40 }}>
        {chips.map((c, i) => {
          const e = ease(f, 30 + i * 9, 48 + i * 9);
          return (
            <div key={c.k} style={{ display: "flex", alignItems: "center", gap: 16, fontFamily: MONO, fontSize: 23, opacity: e, transform: `translateX(${(1 - e) * -30}px)` }}>
              <span style={{ width: 10, height: 10, background: c.c ?? ACC, boxShadow: `0 0 12px ${c.c ?? ACC}` }} />
              <span style={{ color: DIM }}>{c.k}</span>
              <span style={{ color: TXT }}>{c.v}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Телефон с экраном приложения: рамка, уголки, линия сканирования. */
const Phone: React.FC<{ src: string; x: number; y?: number; delay?: number; h?: number; tilt?: number; scan?: boolean }> = ({ src, x, y = 150, delay = 0, h = 840, tilt = 0, scan = true }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: f - delay, fps, config: { damping: 20, stiffness: 90 } });
  const w = h * (390 / 844);
  const sy = ((f - delay) * 9) % (h + 200) - 100;
  const float = Math.sin((f + delay) / 40) * 6;
  return (
    <div style={{ position: "absolute", left: x, top: y + (1 - e) * 120 + float, width: w + 24, height: h + 24, opacity: e, transform: `perspective(1600px) rotateY(${tilt * (1 - e * 0.4)}deg)` }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 54, background: "#0B1226", border: "2px solid rgba(140,170,255,.35)", boxShadow: `0 40px 90px rgba(0,0,0,.6), 0 0 60px ${ACC}22` }} />
      <div style={{ position: "absolute", left: 12, top: 12, width: w, height: h, borderRadius: 44, overflow: "hidden" }}>
        <Img src={staticFile(`demo/${src}.png`)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
        {scan && <div style={{ position: "absolute", left: 0, right: 0, top: sy, height: 120, background: `linear-gradient(180deg, transparent, ${CYAN}1F, transparent)` }} />}
      </div>
      <Corners w={w + 24} h={h + 24} />
    </div>
  );
};

const Corners: React.FC<{ w: number; h: number; c?: string }> = ({ w, h, c = CYAN }) => {
  const s = 26, o = -14;
  const st: React.CSSProperties = { position: "absolute", width: s, height: s, borderColor: c, borderStyle: "solid", borderWidth: 0 };
  return (
    <>
      <div style={{ ...st, left: o, top: o, borderLeftWidth: 3, borderTopWidth: 3 }} />
      <div style={{ ...st, left: w - s - o, top: o, borderRightWidth: 3, borderTopWidth: 3 }} />
      <div style={{ ...st, left: o, top: h - s - o, borderLeftWidth: 3, borderBottomWidth: 3 }} />
      <div style={{ ...st, left: w - s - o, top: h - s - o, borderRightWidth: 3, borderBottomWidth: 3 }} />
    </>
  );
};

/** Счетчик суммы. */
const Count: React.FC<{ to: number; from?: number; at: number; dur?: number; style?: React.CSSProperties; suffix?: string }> = ({ to, from = 0, at, dur = 40, style, suffix = " ₽" }) => {
  const f = useCurrentFrame();
  const v = Math.round(from + (to - from) * ease(f, at, at + dur));
  return <span style={style}>{v.toLocaleString("ru-RU").replace(/ /g, " ")}{suffix}</span>;
};

/* ───── сцены ───── */

const Intro: React.FC = () => {
  const f = useCurrentFrame();
  const a = ease(f, 4, 30), b = ease(f, 20, 50), line = ease(f, 30, 80);
  return (
    <AbsoluteFill>
      <Grid />
      <div style={{ position: "absolute", left: 140, top: 330, fontFamily: SANS, color: TXT }}>
        <div style={{ fontFamily: MONO, fontSize: 26, color: CYAN, letterSpacing: 3, opacity: a }}>ДЕМОНСТРАЦИЯ ПРОДУКТА</div>
        <div style={{ fontSize: 170, fontWeight: 900, letterSpacing: -6, lineHeight: 1, marginTop: 20, opacity: a, transform: `translateY(${(1 - a) * 40}px)` }}>
          Step<span style={{ color: ACC }}>Pay</span>
        </div>
        <div style={{ fontSize: 46, color: "#B7C2E6", marginTop: 26, opacity: b }}>Оплата работ по этапам с резервом средств</div>
        <div style={{ marginTop: 60, display: "flex", alignItems: "center", gap: 18, fontFamily: MONO, fontSize: 22, color: DIM }}>
          {["ДОГОВОР", "РЕЗЕРВ", "СДАЧА", "ПРИЕМКА", "ВЫПЛАТА"].map((s, i) => {
            const on = line * 5 > i;
            return (
              <React.Fragment key={s}>
                <span style={{ color: on ? TXT : DIM, padding: "10px 16px", border: `1px solid ${on ? ACC : "rgba(255,255,255,.12)"}`, background: on ? `${ACC}22` : "transparent" }}>{s}</span>
                {i < 4 && <span style={{ width: 40, height: 2, background: on ? CYAN : "rgba(255,255,255,.12)" }} />}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Scene: React.FC<{ step: number; label: string; children: React.ReactNode; glow?: string }> = ({ step, label, children, glow }) => (
  <AbsoluteFill>
    <Grid glow={glow} />
    <Hud step={step} total={9} label={label} />
    {children}
  </AbsoluteFill>
);

const Catalog = () => (
  <Scene step={1} label="КАТАЛОГ">
    <Copy n="01 / ЗАКАЗЧИК" title="Находит исполнителя" text="Каталог услуг и проектов: рейтинг, отзывы, отметка о проверке данных." chips={[{ k: "услуга", v: "Ремонт ванных комнат и квартир" }, { k: "исполнитель", v: "Иван Петров, самозанятый" }]} />
    <Phone src="m01_catalog" x={1180} tilt={-8} />
  </Scene>
);

const Chat = () => (
  <Scene step={2} label="ЧАТ">
    <Copy n="02 / ДОГОВОРЕННОСТЬ" title="Обсуждают задачу в чате" text="Исполнитель регистрирует задачу с согласованной суммой прямо из переписки." chips={[{ k: "задача", v: "Ремонт ванной под ключ" }, { k: "сумма", v: "280 000 ₽", c: CYAN }]} />
    <Phone src="m02_chat" x={1180} tilt={-8} />
  </Scene>
);

const Terms = () => (
  <Scene step={3} label="УСЛОВИЯ">
    <Copy n="03 / ИСПОЛНИТЕЛЬ" title="Делит работу на этапы" text="Сумма и критерии приемки каждого этапа, срок и неустойка за просрочку." chips={[{ k: "этап 1", v: "Демонтаж и черновые работы  110 000 ₽" }, { k: "этап 2", v: "Электрика и сантехника  90 000 ₽" }, { k: "этап 3", v: "Чистовая отделка  80 000 ₽" }, { k: "неустойка", v: "0,5 % в сутки, не более 10 %", c: AMBER }]} w={820} />
    <Phone src="m03_terms" x={1180} tilt={-8} />
  </Scene>
);

const Contract = () => {
  const f = useCurrentFrame();
  const hash = "12f4c2105b5d06e7eed023a487625e146b587ced55eea79c6d91393aa7e7ba75"; // хеш условий сделки с экранов
  const shown = Math.floor(ease(f, 40, 90) * hash.length);
  return (
    <Scene step={4} label="КОНТРАКТ">
      <Copy n="04 / ПОДПИСЬ" title="Условия зафиксированы" text="Хеш условий записывается в контракт. После подписи сторон изменить их нельзя." chips={[{ k: "алгоритм", v: "SHA-256" }, { k: "подписи", v: "исполнитель, заказчик", c: GREEN }]} />
      <div style={{ position: "absolute", left: 90, top: 860, fontFamily: MONO, fontSize: 22, color: CYAN, width: 900, wordBreak: "break-all" }}>{hash.slice(0, shown)}<span style={{ opacity: f % 20 < 10 ? 1 : 0 }}>▌</span></div>
      <Phone src="m04_review" x={1180} tilt={-8} />
    </Scene>
  );
};

const Reserve = () => {
  const f = useCurrentFrame();
  const e = ease(f, 20, 50);
  return (
    <Scene step={5} label="РЕЗЕРВ" glow={CYAN}>
      <Copy n="05 / ЗАКАЗЧИК" title="Резервирует всю сумму" text="Деньги лежат в эскроу-кошельке сделки. Забрать их в одиночку не может ни одна из сторон." />
      <div style={{ position: "absolute", left: 90, top: 700, fontFamily: SANS, opacity: e }}>
        <div style={{ fontFamily: MONO, fontSize: 22, color: DIM }}>В РЕЗЕРВЕ</div>
        <Count to={280000} at={24} dur={50} style={{ fontSize: 110, fontWeight: 900, color: TXT, letterSpacing: -3 }} />
      </div>
      <Phone src="m06_reserved" x={1180} tilt={-8} />
    </Scene>
  );
};

const Stages = () => {
  const f = useCurrentFrame();
  const bar = ease(f, 60, 110);
  return (
    <Scene step={6} label="ЭТАПЫ" glow={GREEN}>
      <Copy n="06 / СДАЧА И ПРИЕМКА" title="Оплата за принятый этап" text="Исполнитель сдает результат, заказчик принимает. Сумма этапа сразу уходит исполнителю." w={640} />
      <div style={{ position: "absolute", left: 90, top: 760, width: 620, fontFamily: MONO, fontSize: 22, color: DIM }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span>ВЫПЛАЧЕНО</span><Count to={110000} at={60} dur={50} style={{ color: GREEN }} /></div>
        <div style={{ marginTop: 14, height: 10, background: "rgba(255,255,255,.08)" }}><div style={{ height: 10, width: `${(110 / 280) * 100 * bar}%`, background: GREEN, boxShadow: `0 0 16px ${GREEN}` }} /></div>
        <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}><span>В РЕЗЕРВЕ</span><Count from={280000} to={170000} at={60} dur={50} style={{ color: TXT }} /></div>
      </div>
      <Phone src="m07_submitted" x={790} h={780} y={180} tilt={-6} />
      <Phone src="m08_progress" x={1260} h={780} y={180} delay={30} tilt={-6} />
    </Scene>
  );
};

const Journal = () => (
  <Scene step={7} label="ЖУРНАЛ">
    <Copy n="07 / ПРОВЕРКА" title="Каждое действие в журнале" text="Записи связаны цепочкой хешей. Контракт и журнал можно сверить на устройстве и в тестовой сети." chips={[{ k: "контракт", v: "без изменений", c: GREEN }, { k: "журнал", v: "цепочка цела", c: GREEN }, { k: "сеть", v: "Ethereum Sepolia" }]} />
    <Phone src="m09_journal" x={1180} tilt={-8} />
  </Scene>
);

const Wallet = () => (
  <Scene step={8} label="КОШЕЛЕК" glow={GREEN}>
    <Copy n="08 / ИСПОЛНИТЕЛЬ" title="Видит оплату и резерв" text="Получено за принятые этапы и сумма, которая ждет выплаты по сделке." chips={[{ k: "получено", v: "110 000 ₽", c: GREEN }, { k: "ожидает выплаты", v: "170 000 ₽" }]} w={640} />
    <Phone src="m10_wallet" x={790} h={780} y={180} tilt={-6} />
    <Phone src="m11_deals" x={1260} h={780} y={180} delay={24} tilt={-6} />
  </Scene>
);

/** Окно браузера с панелью администратора: экраны сменяются внутри. */
const Admin = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame: f - 6, fps, config: { damping: 20, stiffness: 80 } });
  const shots = [
    { src: "a01_dashboard", at: 0, t: "Показатели: резервы, выплаты, споры" },
    { src: "a02_transactions", at: 80, t: "Операции участников: резервы, выплаты, неустойки" },
    { src: "a05_projects", at: 155, t: "Проверка проектов перед публикацией" },
  ];
  const cur = [...shots].reverse().find((s) => f >= s.at) ?? shots[0];
  const W = 1300, H = W * (900 / 1440);
  return (
    <Scene step={9} label="АДМИНИСТРАТОР">
      <div style={{ position: "absolute", left: 90, top: 130, fontFamily: SANS, color: TXT }}>
        <span style={{ fontFamily: MONO, fontSize: 24, color: CYAN }}>09 / ПАНЕЛЬ АДМИНИСТРАТОРА </span>
        <span style={{ fontSize: 34, fontWeight: 700, marginLeft: 18 }}>{cur.t}</span>
      </div>
      <div style={{ position: "absolute", left: (1920 - W) / 2, top: 190 + (1 - e) * 80, width: W, opacity: e }}>
        <div style={{ height: 44, background: "#0E1630", border: "1px solid rgba(140,170,255,.3)", borderBottom: 0, display: "flex", alignItems: "center", gap: 10, padding: "0 18px" }}>
          {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />)}
          <span style={{ marginLeft: 20, fontFamily: MONO, fontSize: 18, color: DIM }}>steppay-web.vercel.app/admin</span>
        </div>
        <div style={{ position: "relative", width: W, height: H, overflow: "hidden", border: "1px solid rgba(140,170,255,.3)", boxShadow: `0 40px 100px rgba(0,0,0,.6), 0 0 80px ${ACC}22` }}>
          {shots.map((s, i) => {
            const o = interpolate(f, [s.at, s.at + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const zoom = interpolate(f, [s.at, s.at + 90], [1, 1.04], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            return <Img key={s.src} src={staticFile(`demo/${s.src}.png`)} style={{ position: "absolute", inset: 0, width: "100%", opacity: f >= s.at ? o : 0, transform: `scale(${zoom})`, transformOrigin: i === 1 ? "60% 30%" : "30% 30%", zIndex: i }} />;
          })}
        </div>
        <Corners w={W} h={H + 44} />
      </div>
    </Scene>
  );
};

const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const a = ease(f, 4, 30), b = ease(f, 22, 50);
  return (
    <AbsoluteFill>
      <Grid />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: SANS, color: TXT, textAlign: "center" }}>
        <div style={{ fontSize: 150, fontWeight: 900, letterSpacing: -5, opacity: a, transform: `scale(${0.94 + a * 0.06})` }}>Step<span style={{ color: ACC }}>Pay</span></div>
        <div style={{ fontSize: 46, color: "#B7C2E6", marginTop: 24, opacity: b }}>Деньги движутся только за принятый результат</div>
        <div style={{ fontFamily: MONO, fontSize: 22, color: DIM, marginTop: 50, opacity: b, letterSpacing: 2 }}>РЕЗЕРВ · ЭТАПЫ · НЕУСТОЙКА · НЕЗАВИСИМЫЙ ПРИЕМЩИК · ЖУРНАЛ</div>
      </div>
    </AbsoluteFill>
  );
};

const LIST = [Intro, Catalog, Chat, Terms, Contract, Reserve, Stages, Journal, Wallet, Admin, Outro];

export const StepPayDemo: React.FC = () => (
  <TransitionSeries>
    {LIST.map((C, i) => (
      <React.Fragment key={i}>
        <TransitionSeries.Sequence durationInFrames={SCENES[i]!}>
          <C />
        </TransitionSeries.Sequence>
        {i < LIST.length - 1 && <TransitionSeries.Transition presentation={i % 3 === 2 ? fade() : slide({ direction: "from-right" })} timing={linearTiming({ durationInFrames: T })} />}
      </React.Fragment>
    ))}
  </TransitionSeries>
);
