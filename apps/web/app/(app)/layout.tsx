"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CreateSheet } from "@/components/create-sheet";
import { Icon, Initials, Logo } from "@/components/ui";
import { useSession } from "@/lib/session";

const TABS = [
  { href: "/deals", label: "Сделки", icon: "deals" },
  { href: "/projects", label: "Проекты", icon: "sprout" },
  null,
  { href: "/wallet", label: "Кошелёк", icon: "wallet" },
  { href: "/profile", label: "Профиль", icon: "user" },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, ready } = useSession();
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

  // быстрые действия на главной открывают мастер создания сделки
  useEffect(() => {
    const open = () => setCreate(true);
    window.addEventListener("steppay:create", open);
    return () => window.removeEventListener("steppay:create", open);
  }, []);

  if (!user) return <div className="shell"><div className="page"><div className="skeleton" /><div className="skeleton" /></div></div>;

  return (
    <div className="shell">
      {children}
      {demo && (
        <Link href="/demo" className="demo-pill" aria-label="Вернуться к демо-сценарию">▶ Демо</Link>
      )}
      <nav className="tabbar">
        <Link href="/deals" className="side-logo" aria-label="StepPay"><Logo /></Link>
        {TABS.map((t) =>
          t ? (
            <Link key={t.href} href={t.href} className={`tab ${path.startsWith(t.href) ? "on" : ""}`}>
              <Icon name={t.icon} />
              {t.label}
            </Link>
          ) : (
            <button key="plus" className="plus" onClick={() => setCreate(true)} aria-label="Создать">
              <Icon name="plus" />
              <span className="plus-label">Новая сделка</span>
            </button>
          ),
        )}
        <Link href="/profile" className="side-user">
          <Initials name={user.name} />
          <div className="grow">
            <div style={{ fontWeight: 700 }} className="ellipsis">{user.name}</div>
            <div className="small muted">{user.phone ?? "Демо-аккаунт"}</div>
          </div>
        </Link>
      </nav>
      {create && <CreateSheet onClose={() => setCreate(false)} />}
    </div>
  );
}
