"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, Initials } from "@/components/ui";
import { api, type WalletView } from "@/lib/api";
import { useSession, usePoll } from "@/lib/session";

const ROLE: Record<string, string> = { customer: "Заказчик", executor: "Исполнитель", sponsor: "Спонсор", funder: "Грантодатель", arbiter: "Приёмщик споров" };

export default function Profile() {
  const { user, users, login, logout, toast } = useSession();
  const router = useRouter();
  const { data } = usePoll(() => api<WalletView>("/wallet"), [user?.id]);
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  if (!user) return null;

  const payouts = data?.history.filter((h) => h.type === "payout").length ?? 0;

  function theme() {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("steppay.theme", next); } catch { /* ignore */ }
    setDark(!dark);
  }

  return (
    <div className="page">
      <div className="hero" style={{ textAlign: "center", paddingTop: 28 }}>
        <div style={{ display: "grid", placeItems: "center" }}>
          <div className="avatar" style={{ width: 84, height: 84, fontSize: 30, background: "#fff", color: "var(--blue)" }}>{user.name.replace(/[«»]/g, "").split(" ").map((w) => w[0]).slice(0, 2).join("")}</div>
        </div>
        <div className="big" style={{ fontSize: 26, margin: "12px 0 2px" }}>{user.name}</div>
        <div className="label">{ROLE[user.role]}</div>
      </div>

      <div className="card row" style={{ justifyContent: "space-around", textAlign: "center" }}>
        <div><div className="h1">{payouts}</div><div className="small muted">получено выплат</div></div>
        <div><div className="h1">0</div><div className="small muted">споров</div></div>
      </div>

      <h2 className="title">Сменить пользователя (демо)</h2>
      <div className="card stack" style={{ gap: 4, padding: 8 }}>
        {users.map((u) => (
          <button key={u.id} className="row" style={{ padding: 8, borderRadius: 14, background: u.id === user.id ? "var(--blue-soft)" : "transparent", textAlign: "left" }}
            onClick={async () => { if (u.id === user.id) return; await login(u.id); toast(`Вы вошли как ${u.name}`); router.push("/deals"); }}>
            <Initials name={u.name} />
            <div className="grow"><b>{u.name}</b><div className="small muted">{ROLE[u.role]}</div></div>
            {u.id === user.id && <Icon name="check" size={20} />}
          </button>
        ))}
      </div>

      <div className="card stack" style={{ gap: 0 }}>
        <button className="row between" style={{ padding: "12px 0" }} onClick={theme}>
          <span className="row"><Icon name="moon" size={22} /> Тёмная тема</span><span className="chip">{dark ? "Вкл" : "Выкл"}</span>
        </button>
        <button className="row between" style={{ padding: "12px 0" }} onClick={() => { logout(); router.replace("/login"); }}>
          <span className="row"><Icon name="logout" size={22} /> Выйти</span><Icon name="arrow" size={18} />
        </button>
      </div>
      <p className="small muted" style={{ textAlign: "center" }}>StepPay · оплата по шагам в цифровых рублях · Версия 0.3</p>
    </div>
  );
}
