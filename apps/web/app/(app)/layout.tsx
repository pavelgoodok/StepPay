"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CreateSheet } from "@/components/create-sheet";
import { Ava, Icon, Logo } from "@/components/ui";
import { useSession } from "@/lib/session";

const TABS = [
  { href: "/deals", label: "Сделки", icon: "deals" },
  { href: "/catalog", label: "Каталог", icon: "sprout" },
  null,
  { href: "/chats", label: "Чаты", icon: "chat" },
  { href: "/profile", label: "Профиль", icon: "user" },
];
const ADMIN_TABS = [{ href: "/admin", label: "Проверка", icon: "shield" }, ...TABS.slice(1)];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, ready, adminLocked } = useSession();
  const router = useRouter();
  const path = usePathname();
  const [create, setCreate] = useState(false);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    try { setDemo(localStorage.getItem("steppay.demo") !== null); } catch { /* ignore */ }
  }, [path]);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  // быстрые действия на главной открывают меню добавления
  useEffect(() => {
    const open = () => setCreate(true);
    window.addEventListener("steppay:create", open);
    return () => window.removeEventListener("steppay:create", open);
  }, []);

  const active = (href: string) => path.startsWith(href) || (href === "/catalog" && (path.startsWith("/projects") || path.startsWith("/services")));

  // не вошли: идет переход на экран входа, оболочку не показываем
  if (ready && !user) return null;
  const tabs = user?.role === "admin" ? ADMIN_TABS : TABS;

  return (
    <div className="shell">
      {adminLocked && (
        <div className="note warn" style={{ margin: "12px 16px 0" }}>
          Администратору нужен вход по passkey. <Link href="/profile" style={{ fontWeight: 700 }}>Добавьте passkey в профиле</Link> и войдите с ним.
        </div>
      )}
      {user ? children : <div className="page"><div className="skeleton" /></div>}
      {demo && (
        <Link href="/demo" className="demo-pill" aria-label="Вернуться к демо-сценарию">▶ Демо</Link>
      )}
      <nav className="tabbar">
        <Link href="/deals" className="side-logo" aria-label="StepPay"><Logo /></Link>
        {tabs.map((t) =>
          t ? (
            <Link key={t.href} href={t.href} className={`tab ${active(t.href) ? "on" : ""}`}>
              <span className="ti"><Icon name={t.icon} /></span>
              {t.label}
            </Link>
          ) : (
            <button key="plus" className="plus" onClick={() => setCreate(true)} aria-label="Создать">
              <Icon name="plus" />
              <span className="plus-label">Добавить</span>
            </button>
          ),
        )}
        <Link href="/profile" className="side-user" aria-label="Профиль">
          {user ? (
            <>
              <Ava name={user.name} src={user.avatar} />
              <div className="grow">
                <div style={{ fontWeight: 700 }} className="ellipsis">{user.name}</div>
                <div className="small muted">{user.phone ?? "Демо-аккаунт"}</div>
              </div>
            </>
          ) : (
            <span style={{ minHeight: 44 }} />
          )}
        </Link>
      </nav>
      {user && create && <CreateSheet onClose={() => setCreate(false)} />}
    </div>
  );
}
