"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Ava, Icon, Initials, Sheet, Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession, usePoll } from "@/lib/session";

const ROLE: Record<string, string> = { customer: "Заказчик", executor: "Исполнитель", sponsor: "Спонсор", funder: "Грантодатель", arbiter: "Приемщик споров", user: "Участник StepPay" };

export default function Profile() {
  const { user, users, login, logout, toast, refresh } = useSession();
  const router = useRouter();
  const { data } = usePoll(() => api<{ rating: number | null; acceptedStages: number; disputes: number; about: string }>(`/users/${user?.id}/public`), [user?.id]);
  const [dark, setDark] = useState(false);
  const [notif, setNotif] = useState(false);
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
    if (typeof Notification !== "undefined") setNotif(Notification.permission === "granted");
  }, []);
  if (!user) return null;
  const registered = user.role === "user";

  function theme(v: boolean) {
    const next = v ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("steppay.theme", next); } catch { /* ignore */ }
    setDark(v);
  }

  async function notifications(v: boolean) {
    if (!v) return toast("Отключить уведомления можно в настройках браузера");
    if (typeof Notification === "undefined") return toast("Браузер не поддерживает уведомления", "err");
    const r = await Notification.requestPermission();
    setNotif(r === "granted");
    toast(r === "granted" ? "Уведомления включены" : "Уведомления запрещены в браузере", r === "granted" ? "ok" : "err");
  }

  async function save() {
    setBusy(true);
    try {
      await api("/me/profile", { method: "POST", body: { name, about } });
      await refresh();
      setEdit(false);
      toast("Профиль сохранен");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="card pcard">
        <Ava name={user.name} size="lg" />
        <h1 className="h1" style={{ fontSize: 28, marginTop: 8 }}>{user.name}</h1>
        <div className="muted">{ROLE[user.role]}{user.phone ? ` · ${user.phone}` : ""}</div>
        {data?.about && <p style={{ marginTop: 8, maxWidth: 360, lineHeight: 1.45 }}>{data.about}</p>}
        {registered && (
          <button className="btn soft sm" style={{ marginTop: 12 }} onClick={() => { setName(user.name); setAbout(data?.about ?? ""); setEdit(true); }}>
            <Icon name="user" size={16} /> Редактировать профиль
          </button>
        )}
      </div>

      <div className="tiles">
        <div className="tile"><b>{data?.rating != null ? data.rating.toFixed(1).replace(".", ",") : "-"}</b><span>рейтинг</span></div>
        <div className="tile"><b>{data?.acceptedStages ?? 0}</b><span>принято этапов</span></div>
        <div className="tile"><b>{data?.disputes ?? 0}</b><span>споров</span></div>
      </div>

      <div className="card" style={{ padding: "6px 18px" }}>
        <Link href={`/u/${user.id}`} className="setrow">
          <span className="setic"><Icon name="user" size={20} /></span><span className="grow"><b>Моя публичная карточка</b><div className="small muted">Что видят другие о вас</div></span><Icon name="arrow" size={18} />
        </Link>
        <Link href="/receipts" className="setrow">
          <span className="setic"><Icon name="check" size={20} /></span><span className="grow"><b>Мои чеки</b><div className="small muted">По выплатам за этапы</div></span><Icon name="arrow" size={18} />
        </Link>
      </div>

      <div className="card" style={{ padding: "6px 18px" }}>
        <div className="setrow">
          <span className="setic"><Icon name="moon" size={20} /></span><span className="grow"><b>Темная тема</b></span><Switch on={dark} onChange={theme} label="Темная тема" />
        </div>
        <div className="setrow">
          <span className="setic"><Icon name="clock" size={20} /></span><span className="grow"><b>Уведомления на устройстве</b><div className="small muted">Когда сделка требует внимания</div></span><Switch on={notif} onChange={notifications} label="Уведомления" />
        </div>
        <button className="setrow" onClick={() => { logout(); router.replace("/login"); }}>
          <span className="setic"><Icon name="logout" size={20} /></span><span className="grow"><b>Выйти</b></span>
        </button>
      </div>

      {users.length > 0 && (
        <>
          <div className="sec"><h2>Демо-аккаунты</h2></div>
          <div className="card stack" style={{ gap: 6, padding: 12 }}>
            {users.map((u) => (
              <button key={u.id} className="row" style={{ padding: 8, borderRadius: 16, textAlign: "left", boxShadow: u.id === user.id ? "var(--inset-sm)" : "none" }}
                onClick={async () => { if (u.id === user.id) return; await login(u.id); toast(`Вы вошли как ${u.name}`); router.push("/deals"); }}>
                <Initials name={u.name} />
                <div className="grow"><b>{u.name}</b><div className="small muted">{ROLE[u.role]}</div></div>
                {u.id === user.id && <Icon name="check" size={20} />}
              </button>
            ))}
          </div>
        </>
      )}
      <p className="small muted" style={{ textAlign: "center" }}>StepPay, оплата по шагам в цифровых рублях. Версия 0.6</p>

      {edit && (
        <Sheet onClose={() => setEdit(false)}>
          <h2>Профиль</h2>
          <div className="stack" style={{ marginTop: 16, gap: 16 }}>
            <div className="field"><label>Имя</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
            <div className="field"><label>Номер телефона</label><input className="input" value={user.phone ?? ""} disabled /></div>
            <div className="field">
              <label>О себе</label>
              <textarea className="input" maxLength={160} placeholder="Чем занимаетесь, какой опыт. Увидят в публичной карточке" value={about} onChange={(e) => setAbout(e.target.value)} />
              <span className="small muted" style={{ textAlign: "right" }}>{about.length} из 160</span>
            </div>
            <button className="btn" disabled={busy || name.trim().length < 2} onClick={save}>{busy ? <span className="spin" /> : "Сохранить"}</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
