"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, type ProjectFull, type ProjectKind } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Icon, Sheet } from "./ui";

const OPTIONS = [
  { id: "service", title: "Услуга", text: "Опишите услугу, чтобы получать заказы", icon: "hammer" },
  { id: "crowdfunding", title: "Проект на сбор средств", text: "Краудфандинг: деньги от поддержавших, выплата по этапам", icon: "crowd" },
  { id: "grant", title: "Проект на грант", text: "Заявка для грантодателей, проходит проверку", icon: "award" },
] as const;

export function CreateSheet({ onClose }: { onClose(): void }) {
  const router = useRouter();
  const { user, toast, setMode } = useSession();
  const pro = user?.kind === "executor";
  const [kind, setKind] = useState<ProjectKind | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    if (!kind) return;
    setBusy(true);
    try {
      const p = await api<ProjectFull>("/projects", { method: "POST", body: { kind, title: title.trim() } });
      onClose();
      router.push(`/projects/${p.id}/edit`);
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(false);
    }
  }

  if (!pro) {
    return (
      <Sheet onClose={onClose}>
        <h2>Профессиональный аккаунт</h2>
        <p className="sub" style={{ margin: "8px 0 16px", textAlign: "center" }}>Создание услуг и проектов доступно в профессиональном аккаунте. В личном аккаунте можно просматривать каталог и выбирать исполнителей.</p>
        <button className="btn" onClick={() => setMode("executor").catch((e) => toast((e as Error).message, "err"))}>Переключиться на профессиональный аккаунт</button>
        <button className="btn ghost" onClick={onClose}>Закрыть</button>
      </Sheet>
    );
  }

  if (kind) {
    return (
      <Sheet onClose={onClose}>
        <button className="btn ghost sm" onClick={() => setKind(null)} style={{ marginBottom: 4, alignSelf: "flex-start" }}><Icon name="back" size={18} /> Назад</button>
        <h2 style={{ textAlign: "left", fontSize: 24 }}>{kind === "grant" ? "Заявка на грант" : "Проект на сбор средств"}</h2>
        <p className="sub" style={{ margin: "4px 0 14px" }}>Далее необходимо заполнить анкету и описание, приложить документы. Проект будет опубликован после проверки.</p>
        <div className="stack">
          <input className="input" autoFocus placeholder="Название проекта" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button className="btn" disabled={busy || title.trim().length < 3} onClick={start}>Продолжить</button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose}>
      <h2>Выберите действие</h2>
      <div className="stack" style={{ marginTop: 16 }}>
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            className="mode"
            onClick={() => {
              if (o.id === "service") {
                onClose();
                router.push("/services/new");
              } else setKind(o.id);
            }}
          >
            <div className="ico"><Icon name={o.icon} size={26} /></div>
            <div className="grow">
              <div className="title">{o.title}</div>
              <div className="sub">{o.text}</div>
            </div>
            <Icon name="arrow" size={20} />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
