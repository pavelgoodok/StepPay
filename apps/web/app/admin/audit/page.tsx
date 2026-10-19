"use client";
import { Empty, PageHead } from "@/components/admin";
import { dateTime } from "@/lib/admin";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/session";

export default function Audit() {
  const { data } = usePoll(() => api<{ at: number; byName: string; action: string; target?: string; detail?: string }[]>("/admin/audit"), [], 30_000);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Журнал действий" sub="Решения администраторов и доступ к закрытым данным: последние 200 записей" />
      {!data && <div className="skeleton" />}
      {data?.length === 0 && <Empty text="Записей пока нет" />}
      {data && data.length > 0 && (
        <div className="card adm-tablewrap">
          <table className="adm-table">
            <thead><tr><th>Дата</th><th>Администратор</th><th>Действие</th><th>Подробности</th></tr></thead>
            <tbody>
              {data.map((e, i) => (
                <tr key={i}>
                  <td className="muted nowrap">{dateTime(e.at)}</td>
                  <td>{e.byName}</td>
                  <td><b>{e.action}</b></td>
                  <td className="muted">{e.detail ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
