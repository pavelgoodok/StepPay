"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IMG, Initials } from "@/components/ui";
import { useSession } from "@/lib/session";

const ROLE: Record<string, string> = {
  customer: "Заказчик — ремонт, сайт, свадьба",
  executor: "Исполнитель — мастер, студия",
  sponsor: "Спонсор краудфандинга",
  funder: "Грантодатель",
  arbiter: "Независимый приёмщик споров",
};

export default function Login() {
  const { users, user, login, toast } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (user) router.replace("/deals");
  }, [user, router]);

  async function go(id: string) {
    setBusy(id);
    try {
      await login(id);
      router.replace("/deals");
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(null);
    }
  }

  return (
    <div className="login">
      <div className="logo-box">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="StepPay" />
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="art" src={IMG.safe} alt="" />
      <div style={{ marginTop: 40, maxWidth: 260 }}>
        <h1>Оплата по шагам</h1>
        <p style={{ marginTop: 10 }}>Деньги уходят только за принятый этап. В цифровых рублях.</p>
      </div>
      <div style={{ flex: 1, minHeight: 20 }} />
      <Link href="/demo" className="who" style={{ background: "#fff", color: "var(--blue)", fontWeight: 800 }}>
        <div className="grow">▶ Демо-сценарий для жюри · 3 минуты</div>
        <span>→</span>
      </Link>
      <p className="small" style={{ opacity: 0.85 }}>Или выберите роль и войдите в один клик</p>
      <div className="stack">
        {users.length === 0 && <p className="small">Подключаемся к серверу…</p>}
        {users.map((u) => (
          <button key={u.id} className="who" disabled={!!busy} onClick={() => go(u.id)}>
            <Initials name={u.name} />
            <div className="grow">
              <div style={{ fontWeight: 700 }}>{u.name}</div>
              <div className="small" style={{ opacity: 0.85 }}>{ROLE[u.role]}</div>
            </div>
            <span>{busy === u.id ? "…" : "→"}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
