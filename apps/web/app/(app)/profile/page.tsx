"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, Initials } from "@/components/ui";
import { api, type PublicUser } from "@/lib/api";
import { useSession, usePoll } from "@/lib/session";

const ROLE: Record<string, string> = { customer: "Заказчик", executor: "Исполнитель", sponsor: "Спонсор", funder: "Грантодатель", arbiter: "Приемщик споров", user: "Участник StepPay" };

export default function Profile() {
  const { user, users, login, logout, toast } = useSession();
  const router = useRouter();
  const { data } = usePoll(() => api<{ rating: number | null; acceptedStages: number; disputes: number } & PublicUser>(`/users/${user?.id}/public`), [user?.id]);
  const [dark, setDark] = useState(false);
  const [notif, setNotif] = useState<NotificationPermission | "none">("none");
  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
    if (typeof Notification !== "undefined") setNotif(Notification.permission);
  }, []);
  if (!user) return null;

  async function enableNotifications() {
    if (typeof Notification === "undefined") return toast("Браузер не поддерживает уведомления", "err");
    const r = await Notification.requestPermission();
    setNotif(r);
    toast(r === "granted" ? "Уведомления включены" : "Уведомления отключены в браузере");
  }

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
        <div className="label">{ROLE[user.role]}{user.phone ? ` · ${user.phone}` : ""}</div>
      </div>

      <div className="card row" style={{ justifyContent: "space-around", textAlign: "center" }}>
        <div><div className="h1">{data?.rating != null ? data.rating.toFixed(1).replace(".", ",") : "—"}</div><div className="small muted">рейтинг</div></div>
        <div><div className="h1">{data?.acceptedStages ?? 0}</div><div className="small muted">принято этапов</div></div>
        <div><div className="h1">{data?.disputes ?? 0}</div><div className="small muted">споров</div></div>
      </div>

      <div className="card stack" style={{ gap: 0 }}>
        <Link href={`/u/${user.id}`} className="row between" style={{ padding: "12px 0" }}>
          <span className="row"><Icon name="user" size={22} /> Моя публичная карточка</span><Icon name="arrow" size={18} />
        </Link>
        {(
          <Link href="/receipts" className="row between" style={{ padding: "12px 0" }}>
            <span className="row"><Icon name="check" size={22} /> Мои чеки</span><Icon name="arrow" size={18} />
          </Link>
        )}
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
        <button className="row between" style={{ padding: "12px 0" }} onClick={enableNotifications}>
          <span className="row"><Icon name="clock" size={22} /> Уведомления на устройстве</span><span className="chip">{notif === "granted" ? "Вкл" : "Включить"}</span>
        </button>
        <button className="row between" style={{ padding: "12px 0" }} onClick={() => { logout(); router.replace("/login"); }}>
          <span className="row"><Icon name="logout" size={22} /> Выйти</span><Icon name="arrow" size={18} />
        </button>
      </div>
      <p className="small muted" style={{ textAlign: "center" }}>StepPay · оплата по шагам в цифровых рублях · Версия 0.5</p>
    </div>
  );
}
