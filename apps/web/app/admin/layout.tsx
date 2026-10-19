"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Icon, Logo } from "@/components/ui";
import type { AdminDashboard } from "@/lib/admin";
import { api } from "@/lib/api";
import { useSession, usePoll } from "@/lib/session";

const NAV = [
  { href: "/admin", label: "Показатели", icon: "deals", exact: true },
  { href: "/admin/transactions", label: "Операции", icon: "swap" },
  { href: "/admin/disputes", label: "Споры", icon: "flag", badge: "disputes" },
  { href: "/admin/verifications", label: "Подтверждение", icon: "shield", badge: "verifications" },
  { href: "/admin/projects", label: "Проекты", icon: "sprout", badge: "projects" },
  { href: "/admin/users", label: "Участники", icon: "user" },
  { href: "/admin/registry", label: "Реестры", icon: "award" },
  { href: "/admin/audit", label: "Журнал", icon: "clock" },
] as const;

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, ready, logout, adminLocked } = useSession();
  const router = useRouter();
  const path = usePathname();
  const isAdmin = user?.role === "admin";
  const dash = usePoll(() => (isAdmin ? api<AdminDashboard>("/admin/dashboard") : Promise.resolve(null)), [isAdmin], 30_000);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  if (!ready || !user) return null;
  if (!isAdmin) {
    return (
      <div className="adm-denied">
        <div className="card stack" style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 className="title">Раздел для администраторов</h1>
          <p className="sub">Этот интерфейс доступен только сотрудникам платформы.</p>
          <Link href="/deals" className="btn">Перейти к сделкам</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="adm">
      <aside className="adm-side">
        <div className="adm-brand"><Logo /><span className="chip gray">Администратор</span></div>
        <nav className="adm-nav">
          {NAV.map((n) => {
            const on = "exact" in n ? path === n.href : path.startsWith(n.href);
            const count = "badge" in n ? dash.data?.queue[n.badge] ?? 0 : 0;
            return (
              <Link key={n.href} href={n.href} className={`adm-link ${on ? "on" : ""}`}>
                <Icon name={n.icon} size={20} />
                <span>{n.label}</span>
                {count > 0 && <b className="adm-count">{count}</b>}
              </Link>
            );
          })}
        </nav>
        <div className="adm-foot">
          <div className="small muted ellipsis">{user.name}</div>
          <Link href="/deals" className="adm-link"><Icon name="back" size={20} /><span>Пользовательский режим</span></Link>
          <button className="adm-link" onClick={() => { logout(); router.replace("/login"); }}><Icon name="logout" size={20} /><span>Выйти</span></button>
        </div>
      </aside>
      <main className="adm-main">
        {adminLocked && (
          <div className="note warn" style={{ marginBottom: 16 }}>
            Администратору нужен вход по passkey. <Link href="/profile" style={{ fontWeight: 700 }}>Добавьте passkey в профиле</Link> и войдите с ним.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
