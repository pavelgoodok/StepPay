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
    <button className="mode-card" onClick={go}>
      <span className="setic"><Icon name="swap" size={20} /></span>
      <span className="grow">
        <b>{pro ? "Профессиональный аккаунт" : "Личный аккаунт"}</b>
        <span className="small">{pro ? "Переключиться на личный аккаунт" : "Переключиться на профессиональный аккаунт"}</span>
      </span>
    </button>
  );
}
