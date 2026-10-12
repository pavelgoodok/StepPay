"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, type DealFull, type FoundUser, type Template } from "@/lib/api";
import { rub, toKopecks } from "@/lib/format";
import { useSession } from "@/lib/session";
import { IMG, Icon, MoneyInput, Sheet } from "./ui";

type Mode = "own" | "crowdfunding" | "grant";
const MODES: { id: Mode; title: string; text: string; icon: string }[] = [
  { id: "own", title: "Свой проект", text: "Ремонт, сайт, свадьба: платите исполнителю по этапам", icon: "hammer" },
  { id: "crowdfunding", title: "Краудфандинг", text: "Соберите деньги на идею, спонсоры защищены", icon: "crowd" },
  { id: "grant", title: "Грант", text: "Выдайте деньги по этапам с готовой отчетностью", icon: "award" },
];
const TPL_ICON: Record<string, string> = { bath: "bath", kitchen: "kitchen", bolt: "bolt", laptop: "laptop", ring: "ring" };

interface Row {
  title: string;
  rub: string;
}

export function CreateSheet({ onClose }: { onClose(): void }) {
  const { toast, refresh } = useSession();
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tpl, setTpl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [total, setTotal] = useState("");
  const [executor, setExecutor] = useState<FoundUser | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundUser[]>([]);
  const [rows, setRows] = useState<Row[]>([{ title: "", rub: "" }]);
  const [busy, setBusy] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiTotal, setAiTotal] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSource, setAiSource] = useState<"claude" | "template" | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);

  useEffect(() => {
    api<Template[]>("/templates").then(setTemplates).catch(() => undefined);
  }, []);
  // поиск исполнителя: точный номер телефона или имя от 3 букв
  useEffect(() => {
    const q = query.trim();
    if (!q || executor) return setFound([]);
    const t = setTimeout(() => api<FoundUser[]>(`/users/search?q=${encodeURIComponent(q)}`).then(setFound).catch(() => setFound([])), 250);
    return () => clearTimeout(t);
  }, [query, executor]);

  const custom = tpl === null;
  const sum = custom ? rows.reduce((a, r) => a + (Number(r.rub) || 0), 0) : Number(total) || 0;
  const preview = useMemo(() => {
    const t = templates.find((x) => x.id === tpl);
    if (!t || !sum) return [];
    return t.stages.map((s) => ({ title: s.title, amount: toKopecks((sum * s.share) / 100) }));
  }, [templates, tpl, sum]);

  function pickTemplate(t: Template | null) {
    setTpl(t?.id ?? null);
    if (t && !title) setTitle(t.title);
  }

  async function askAi() {
    if (!mode) return;
    setAiBusy(true);
    try {
      const plan = await api<{ title: string; source: "claude" | "template"; model?: string; reason?: { code: string; text: string }; stages: { title: string; share: number; criteria: string[] }[] }>("/ai/plan", {
        method: "POST",
        body: { description: aiText.trim(), mode, total: Number(aiTotal) > 0 ? toKopecks(Number(aiTotal)) : undefined },
      });
      const budget = Number(aiTotal) || 0;
      let left = budget;
      setRows(
        plan.stages.map((st, i) => {
          const part = i === plan.stages.length - 1 ? left : Math.round((budget * st.share) / 100);
          left -= part;
          return { title: st.title, rub: budget ? String(part) : "" };
        }),
      );
      setTpl(null);
      if (!title.trim()) setTitle(plan.title);
      setAiSource(plan.source);
      setAiNote(plan.source === "claude" ? null : (plan.reason?.text ?? null));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setAiBusy(false);
    }
  }

  async function submit() {
    if (!mode) return;
    setBusy(true);
    try {
      const body = {
        mode,
        title: title.trim(),
        executorId: mode === "crowdfunding" ? undefined : executor?.id,
        ...(custom
          ? { stages: rows.filter((r) => r.title.trim() && Number(r.rub) > 0).map((r) => ({ title: r.title.trim(), amount: toKopecks(Number(r.rub)) })) }
          : { templateId: tpl, total: toKopecks(Number(total)) }),
      };
      const d = await api<DealFull>("/deals", { method: "POST", body });
      await refresh();
      onClose();
      router.push(`/deals/${d.id}`);
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(false);
    }
  }

  const valid = title.trim().length > 0 && sum > 0 && (mode === "crowdfunding" || !!executor) && (!custom || rows.some((r) => r.title.trim() && Number(r.rub) > 0));

  if (!mode) {
    return (
      <Sheet onClose={onClose}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="art" src={IMG.receipt} alt="" />
        <h2>Что создаем?</h2>
        <p className="sub" style={{ textAlign: "center", marginBottom: 16 }}>Деньги уходят только за принятые этапы</p>
        <div className="stack">
          {MODES.map((m) => (
            <button key={m.id} className="mode" onClick={() => setMode(m.id)}>
              <div className="ico"><Icon name={m.icon} size={26} /></div>
              <div className="grow">
                <div className="title">{m.title}</div>
                <div className="sub">{m.text}</div>
              </div>
              <Icon name="arrow" size={20} />
            </button>
          ))}
        </div>
        <p className="small muted" style={{ textAlign: "center", marginTop: 16 }}>
          <Icon name="lock" size={14} /> Цифровые рубли - без комиссии для граждан
        </p>
      </Sheet>
    );
  }

  const m = MODES.find((x) => x.id === mode)!;
  return (
    <Sheet onClose={onClose}>
      <button className="btn ghost sm" onClick={() => setMode(null)} style={{ marginBottom: 4 }}>
        <Icon name="back" size={18} /> Назад
      </button>
      <h2 style={{ textAlign: "left", fontSize: 24 }}>{m.title}</h2>
      <div className="stack" style={{ marginTop: 14, gap: 16 }}>
        <div className="ai">
          <span className="tag"><Icon name="bolt" size={14} /> ПОМОЩНИК ПО ЭТАПАМ</span>
          <textarea className="input" placeholder="Опишите задачу своими словами: «Переделать ванную 4 м², плитка, замена труб, установка душевой»" value={aiText} onChange={(e) => setAiText(e.target.value)} style={{ minHeight: 76 }} />
          <div className="row">
            <MoneyInput placeholder="Бюджет, ₽" value={aiTotal} onChange={setAiTotal} />
            <button className="btn sm" style={{ whiteSpace: "nowrap" }} disabled={aiBusy || aiText.trim().length < 5} onClick={askAi}>
              {aiBusy ? <span className="spin" /> : "Разбить на этапы"}
            </button>
          </div>
          {aiSource && (
            <div className="small muted">
              {aiSource === "claude" ? "Этапы составлены Claude. Проверьте и поправьте при необходимости." : "Подобран ближайший шаблон, этапы можно изменить."}
              {aiNote && <div style={{ marginTop: 4, color: "var(--amber)" }}>Почему не Claude: {aiNote}</div>}
            </div>
          )}
        </div>
        <div className="field">
          <label>Что нужно сделать</label>
          <div className="chips">
            {templates.map((t) => (
              <button key={t.id} className={`opt ${tpl === t.id ? "on" : ""}`} onClick={() => pickTemplate(t)}>
                {t.title}
              </button>
            ))}
            <button className={`opt ${custom ? "on" : ""}`} onClick={() => pickTemplate(null)}>Свои этапы</button>
          </div>
        </div>
        <div className="field">
          <label>Название</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === "crowdfunding" ? "Например, настольная игра" : "Ремонт ванной"} />
        </div>
        {mode !== "crowdfunding" && (
          <div className="field">
            <label>{mode === "grant" ? "Кому выдаем грант" : "Исполнитель"}</label>
            {executor ? (
              <div className="picked">
                <div className="grow"><b>{executor.name}</b>{executor.phone && <div className="small muted">{executor.phone}</div>}</div>
                <button className="btn soft sm" onClick={() => { setExecutor(null); setQuery(""); }}>Изменить</button>
              </div>
            ) : (
              <>
                <input className="input" placeholder="Номер телефона или имя" value={query} onChange={(e) => setQuery(e.target.value)} />
                {found.map((u) => (
                  <button key={u.id} className="found" onClick={() => setExecutor(u)}>
                    <b>{u.name}</b>
                    {u.phone && <span className="small muted">{u.phone}</span>}
                  </button>
                ))}
                {query.trim().length >= 3 && found.length === 0 && <div className="small muted">Никого не нашли. Исполнитель должен сначала зарегистрироваться в StepPay, затем введите его номер телефона полностью.</div>}
              </>
            )}
          </div>
        )}
        {custom ? (
          <div className="field">
            <label>Этапы</label>
            {rows.map((r, i) => (
              <div key={i} className="row">
                <input className="input" style={{ flex: 2 }} placeholder={`Этап ${i + 1}`} value={r.title} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <MoneyInput style={{ flex: 1 }} placeholder="₽" value={r.rub} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, rub: v } : x)))} />
              </div>
            ))}
            <button className="btn soft sm" onClick={() => setRows([...rows, { title: "", rub: "" }])}>+ Добавить этап</button>
          </div>
        ) : (
          <>
            <div className="field">
              <label>{mode === "crowdfunding" ? "Цель сбора, ₽" : "Общая сумма, ₽"}</label>
              <MoneyInput value={total} onChange={setTotal} placeholder="300 000" />
            </div>
            {preview.length > 0 && (
              <div className="card" style={{ boxShadow: "none", background: "var(--card)" }}>
                <div className="small muted" style={{ marginBottom: 6 }}>Этапы по шаблону</div>
                {preview.map((p, i) => (
                  <div key={i} className="row between" style={{ padding: "6px 0" }}>
                    <span>{i + 1}. {p.title}</span>
                    <b className="mono">{rub(p.amount)}</b>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        <button className="btn" disabled={!valid || busy} onClick={submit}>
          {busy ? "Создаем…" : `Создать${sum ? ` · ${rub(toKopecks(sum))}` : ""}`}
        </button>
      </div>
    </Sheet>
  );
}
