"use client";
import Link from "next/link";
import { Icon } from "./ui";
import { useSession } from "@/lib/session";

/** Заглушка для разделов профессионального аккаунта: в личном аккаунте доступны просмотр и выбор. */
export function ProGate({ back = "/deals" }: { back?: string }) {
  const { setMode, toast } = useSession();
  return (
    <div className="page">
      <Link href={back} className="btn ghost sm" style={{ paddingLeft: 0, alignSelf: "flex-start" }}><Icon name="back" size={18} /> Назад</Link>
      <div className="card stack">
        <div className="title">Раздел профессионального аккаунта</div>
        <div className="sub">Создание и изменение услуг и проектов доступно в профессиональном аккаунте. В личном аккаунте можно просматривать каталог и выбирать исполнителей.</div>
        <button className="btn" onClick={() => setMode("executor").catch((e) => toast((e as Error).message, "err"))}>Переключиться на профессиональный аккаунт</button>
      </div>
    </div>
  );
}

export function useIsPro() {
  const { user } = useSession();
  return user?.kind === "executor";
}
