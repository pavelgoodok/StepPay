"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CreateSheet } from "@/components/create-sheet";
import { ModeSwitch } from "@/components/mode-switch";
import { Ava, Icon, Logo } from "@/components/ui";
import { useSession } from "@/lib/session";

type Tab = { href: string; label: string; icon: string; desk?: boolean } | null;
const badgeOf = (href: string, unread: number, chats: number) => (href === "/notifications" ? unread : href === "/chats" ? chats : 0);
const TABS: Tab[] = [
  { href: "/deals", label: "Сделки", icon: "deals" },
  { href: "/catalog", label: "Каталог", icon: "sprout" },
  null,
  { href: "/chats", label: "Чаты", icon: "chat" },
  { href: "/notifications", label: "Уведомления", icon: "bell", desk: true },
  { href: "/profile", label: "Профиль", icon: "user" },
];
const ADMIN_TABS: Tab[] = [{ href: "/admin", label: "Панель", icon: "shield" }, ...TABS.slice(1)];

/** Стеклянная фигура в правом нижнем углу: кольцо или лента по разделам, лежит под карточками. */
const decoOf = (p: string) => (/^\/(deals|wallet|chats)/.test(p) ? "ring" : "s");

const USER_MODE = "steppay.userMode";
const userModeChosen = () => {
  try {
    return sessionStorage.getItem(USER_MODE) === "1";
  } catch {
    return false;
  }
};

export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, ready, unread, chatUnread } = useSession();
  const router = useRouter();
  const path = usePathname();
  const [create, setCreate] = useState(false);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  // администратор начинает работу в панели: главная пользовательского режима открывается только по кнопке
  // «Пользовательский режим»; карточки проектов и сделок для проверки открываются как обычно
  const adminHere = user?.role === "admin" && path === "/deals" && !userModeChosen();
  useEffect(() => {
    if (ready && adminHere) router.replace("/admin");
  }, [ready, adminHere, router]);

  // быстрые действия на главной открывают меню добавления
  useEffect(() => {
    const open = () => setCreate(true);
    window.addEventListener("steppay:create", open);
    return () => window.removeEventListener("steppay:create", open);
  }, []);

  const active = (href: string) => path.startsWith(href) || (href === "/catalog" && (path.startsWith("/projects") || path.startsWith("/services")));

  // не вошли: идет переход на экран входа, оболочку не показываем
  if ((ready && !user) || adminHere) return null;
  const tabs = user?.role === "admin" ? ADMIN_TABS : TABS;

  return (
    <div className="shell">
      <div className={`deco deco-${decoOf(path)}`} aria-hidden />
      {user ? children : <div className="page"><div className="skeleton" /></div>}
      <nav className="tabbar">
        <div className="side-logo"><Link href="/deals" aria-label="StepPay"><Logo /></Link><span className="mode-side"><ModeSwitch compact /></span></div>
        {tabs.map((t) =>
          t ? (
            <Link key={t.href} href={t.href} className={`tab ${t.desk ? "desk" : ""} ${active(t.href) ? "on" : ""}`}>
              <span className="ti"><Icon name={t.icon} />{badgeOf(t.href, unread, chatUnread) > 0 && <span className="bell-n">{badgeOf(t.href, unread, chatUnread) > 9 ? "9+" : badgeOf(t.href, unread, chatUnread)}</span>}</span>
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
