"use client";
import { Icon } from "./ui";
import { useSession } from "@/lib/session";

/** Переключатель между личным (заказчик) и профессиональным (исполнитель) аккаунтом. */
export function ModeSwitch({ compact }: { compact?: boolean }) {
  const { user, setMode, toast } = useSession();
  if (!user || user.role === "admin" || user.role === "arbiter") return null;
  const pro = user.kind === "executor";
  const next = pro ? "customer" : "executor";
  async function go() {
    try {
      await setMode(next);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }
  if (compact) {
    return (
      <button className="mode-chip" onClick={go} aria-label={pro ? "Переключиться на личный аккаунт" : "Переключиться на профессиональный аккаунт"}>
        <Icon name="swap" size={16} />
        {pro ? "Профессиональный" : "Личный"}
      </button>
    );
  }
  return (
    <button className="card tap row" style={{ gap: 14, width: "100%", textAlign: "left", display: "flex" }} onClick={go}>
      <span className="setic"><Icon name="swap" size={22} /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title">{pro ? "Профессиональный аккаунт" : "Личный аккаунт"}</div>
        <div className="small muted">{pro ? "Переключиться на личный аккаунт" : "Переключиться на профессиональный аккаунт"}</div>
      </div>
      <Icon name="arrow" size={18} />
    </button>
  );
}
