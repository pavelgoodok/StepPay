"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";

/** Вход администратора: доступен только номерам из списка администраторов, права открывает код доступа. */
export default function AdminEntry() {
  const { user, adminEntry, enterAdmin, refresh, toast } = useSession();
  const router = useRouter();
  const [code, setCode] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user?.role === "admin") router.replace("/admin");
    else if (user && !adminEntry) router.replace("/profile");
  }, [user, adminEntry, router]);

  async function createCode() {
    setBusy(true);
    try {
      const r = await api<{ code: string }>("/auth/admin/code", { method: "POST", body: {} });
      setCreated(r.code);
      await refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function enter() {
    setBusy(true);
    try {
      await enterAdmin(code);
      router.replace("/admin");
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(false);
    }
  }

  if (!adminEntry) return <div className="page"><div className="skeleton" /></div>;
  return (
    <div className="page stack" style={{ maxWidth: 520 }}>
      <h1>Вход администратора</h1>
      {!adminEntry.codeSet && !created && (
        <div className="card stack">
          <div className="sub">Для входа в панель администратора нужен код доступа. Он создается один раз и показывается только сейчас: сохраните его в надежном месте. На сервере хранится только его хеш.</div>
          <button className="btn" disabled={busy} onClick={() => void createCode()}>
            {busy ? <span className="spin" /> : <><Icon name="shield" size={18} /> Создать код доступа</>}
          </button>
        </div>
      )}
      {created && (
        <div className="card stack">
          <div className="sub">Ваш код доступа. Больше он показан не будет.</div>
          <div className="mono" style={{ fontSize: 28, fontWeight: 700, letterSpacing: 2, textAlign: "center" }}>{created}</div>
          <button className="btn soft sm" style={{ alignSelf: "center" }} onClick={() => void navigator.clipboard?.writeText(created).then(() => toast("Код скопирован"))}>Скопировать</button>
          <div className="small muted">Чтобы убедиться, что код сохранен, введите его ниже.</div>
        </div>
      )}
      {(adminEntry.codeSet || created) && (
        <div className="card stack">
          <div className="field">
            <label>Код доступа</label>
            <input className="input big-input mono" autoComplete="off" autoCapitalize="characters" placeholder="XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && code.length >= 8 && void enter()} />
          </div>
          <button className="btn" disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length !== 8} onClick={() => void enter()}>
            {busy ? <span className="spin" /> : "Войти как администратор"}
          </button>
          <div className="small muted">Код утерян: его сбрасывает другой администратор в разделе «Участники».</div>
        </div>
      )}
      <Link href="/deals" className="btn ghost">Продолжить как участник</Link>
    </div>
  );
}
