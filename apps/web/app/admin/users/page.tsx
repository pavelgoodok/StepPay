"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty, PageHead } from "@/components/admin";
import { dateTime, type AdminUser } from "@/lib/admin";
import { api } from "@/lib/api";
import { rub } from "@/lib/format";
import { usePoll } from "@/lib/session";

export default function Users() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const { data } = usePoll(() => api<AdminUser[]>(`/admin/users?q=${encodeURIComponent(q)}`), [q], 30_000);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Участники" sub="Зарегистрированные пользователи, режимы аккаунтов и остатки" />
      <input className="input" style={{ maxWidth: 420 }} placeholder="Поиск по имени или телефону" value={text} onChange={(e) => setText(e.target.value)} />
      {!data && <div className="skeleton" />}
      {data?.length === 0 && <Empty text="Никого не найдено" />}
      {data && data.length > 0 && (
        <div className="card adm-tablewrap">
          <table className="adm-table">
            <thead><tr><th>Участник</th><th>Аккаунт</th><th>Роли</th><th className="r">Сделок</th><th className="r">Свободно</th><th className="r">В резерве</th><th>Регистрация</th></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td><Link href={`/users/${u.id}`} className="adm-a"><b>{u.name}</b></Link><div className="small muted">{u.phone ?? (u.demo ? "демо-аккаунт" : "")}</div></td>
                  <td>{u.kind === "executor" ? "Профессиональный" : "Личный"}{u.rating != null && <div className="small muted">Рейтинг {u.rating} ({u.reviews})</div>}</td>
                  <td>
                    <div className="chips" style={{ gap: 6 }}>
                      {u.role === "admin" && <span className="chip gray">Администратор</span>}
                      {u.verified && <span className="chip green">Проверено</span>}
                      {u.grantor && <span className="chip">Грантодатель</span>}
                      {u.arbiter && <span className="chip amber">Приемщик</span>}
                    </div>
                  </td>
                  <td className="r mono">{u.deals}</td>
                  <td className="r mono">{rub(u.free)}</td>
                  <td className="r mono">{rub(u.reserved)}</td>
                  <td className="muted nowrap">{u.createdAt ? dateTime(u.createdAt) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
