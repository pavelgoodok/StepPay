"use client";
import { useState } from "react";
import { PageHead } from "@/components/admin";
import { Ava } from "@/components/ui";
import { api, type Person } from "@/lib/api";
import { useSession, usePoll } from "@/lib/session";

export default function Registry() {
  const { toast } = useSession();
  const [phone, setPhone] = useState("");
  const [aphone, setAphone] = useState("");
  const grantors = usePoll(() => api<Person[]>("/admin/grantors"), []);
  const arbiters = usePoll(() => api<(Person & { resolved: number; paid: number; refunded: number; silent: number })[]>("/arbiters"), []);

  async function setArbiter(value: boolean, p = aphone) {
    try {
      await api("/admin/arbiters", { method: "POST", body: { phone: p, value } });
      setAphone("");
      toast(value ? "Приемщик добавлен в реестр" : "Приемщик убран из реестра");
      await arbiters.reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }
  async function setGrantor(value: boolean, p = phone) {
    try {
      await api("/admin/grantors", { method: "POST", body: { phone: p, value } });
      setPhone("");
      toast(value ? "Грантодатель добавлен" : "Грантодатель удален");
      await grantors.reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Реестры" sub="Грантодатели и независимые приемщики споров" />
      <div className="adm-grid2">
      <h2 className="title">Грантодатели</h2>
      <div className="card stack">
        <div className="sub">Только они могут финансировать гранты. Укажите номер телефона зарегистрированного пользователя.</div>
        {grantors.data?.map((g) => (
          <div key={g.id} className="row">
            <Ava name={g.name} src={g.avatar} size="sm" />
            <b className="grow ellipsis">{g.name}</b>
          </div>
        ))}
        <div className="row">
          <input className="input" inputMode="tel" placeholder="Номер телефона" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className="btn sm" style={{ whiteSpace: "nowrap" }} disabled={phone.replace(/\D/g, "").length < 10} onClick={() => setGrantor(true)}>Добавить</button>
        </div>
      </div>

      <h2 className="title">Приемщики споров</h2>
      <div className="card stack">
        <div className="sub">Заказчик и исполнитель выбирают приемщика и запасного из этого реестра. Репутация считается по решенным спорам.</div>
        {arbiters.data?.map((a) => (
          <div key={a.id} className="row">
            <Ava name={a.name} src={a.avatar} size="sm" />
            <div className="grow" style={{ minWidth: 0 }}>
              <b className="ellipsis">{a.name}</b>
              <div className="small muted">Решил {a.resolved}: выплат {a.paid}, возвратов {a.refunded}{a.silent ? `, не успел ${a.silent}` : ""}</div>
            </div>
          </div>
        ))}
        <div className="row">
          <input className="input" inputMode="tel" placeholder="Номер телефона" value={aphone} onChange={(e) => setAphone(e.target.value)} />
          <button className="btn sm" style={{ whiteSpace: "nowrap" }} disabled={aphone.replace(/\D/g, "").length < 10} onClick={() => setArbiter(true)}>Добавить</button>
        </div>
      </div>

      </div>
    </div>
  );
}
