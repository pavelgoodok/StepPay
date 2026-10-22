"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IMG, Icon, Initials } from "@/components/ui";
import { api, type PublicUser } from "@/lib/api";
import { useSession } from "@/lib/session";

const ROLE: Record<string, string> = {
  customer: "Заказчик",
  executor: "Исполнитель",
  sponsor: "Спонсор краудфандинга",
  funder: "Грантодатель",
  arbiter: "Независимый приемщик споров",
};

/** +7 999 123-45-67 по мере ввода */
function formatPhone(raw: string) {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("8")) d = "7" + d.slice(1);
  if (d.startsWith("7")) d = d.slice(1);
  d = d.slice(0, 10);
  const parts = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)].filter(Boolean);
  if (!parts.length) return "";
  return `+7 ${parts[0]}${parts[1] ? " " + parts[1] : ""}${parts[2] ? "-" + parts[2] : ""}${parts[3] ? "-" + parts[3] : ""}`;
}

type Step = "phone" | "code";

export default function Login() {
  const { users, user, login, completeLogin, toast, adminEntry } = useSession();
  const router = useRouter();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isNew, setIsNew] = useState(false);
  const [kind, setKind] = useState<"customer" | "executor" | null>(null);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);

  // куда идти после входа: новый исполнитель создает витрину услуг, новый заказчик идет в каталог
  const after = useRef("/deals");
  useEffect(() => {
    // номер администратора без кода доступа попадает на выбор: войти администратором или продолжить участником
    if (user) router.replace(user.role === "admin" ? "/admin" : adminEntry ? "/admin-entry" : after.current);
  }, [user, adminEntry, router]);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const digits = phone.replace(/\D/g, "");
  const phoneOk = digits.length === 11;

  async function requestCode() {
    setBusy(true);
    try {
      const r = await api<{ isNew: boolean; demoCode: string | null; retryAfter: number }>("/auth/otp/request", { method: "POST", body: { phone } });
      setIsNew(r.isNew);
      setKind(null);
      setDemoCode(r.demoCode);
      setWait(r.retryAfter);
      setStep("code");
      setCode("");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    try {
      const r = await api<{ token: string }>("/auth/otp/verify", { method: "POST", body: { phone, code: value, name: isNew ? name : undefined, kind: isNew ? kind ?? undefined : undefined } });
      after.current = isNew ? (kind === "executor" ? "/services/new" : "/catalog") : "/deals";
      await completeLogin(r.token);
      router.replace(after.current);
    } catch (e) {
      toast((e as Error).message, "err");
      setCode("");
      setBusy(false);
    }
  }


  async function demoLogin(id: string) {
    setBusy(true);
    try {
      await login(id);
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-brand">
        <div className="logo-box">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="StepPay" />
        </div>
        <div className="brand-grid">
          <div className="brand-copy">
            <h1>Оплата по шагам</h1>
            <p>Средства резервируются в цифровых рублях и выплачиваются исполнителю после приемки этапа.</p>
            <ul className="points">
              <li><Icon name="shield" size={18} /> Резервирование средств до начала работ</li>
              <li><Icon name="check" size={18} /> Выплата после приемки этапа</li>
              <li><Icon name="swap" size={18} /> Автоматический возврат остатка</li>
            </ul>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="art" src={IMG.steps} alt="" />
        </div>
      </div>

      <div className="login-panel">
        <div className="auth-card">
          {step === "phone" ? (
            <>
              <h2>Вход или регистрация</h2>
              <p className="sub">Укажите номер телефона, на него будет отправлен код подтверждения</p>
              <div className="field" style={{ marginTop: 18 }}>
                <label>Номер телефона</label>
                <input className="input big-input" inputMode="tel" autoComplete="tel" autoFocus placeholder="Номер телефона" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} onKeyDown={(e) => e.key === "Enter" && phoneOk && requestCode()} />
              </div>
              <button className="btn" style={{ marginTop: 16 }} disabled={!phoneOk || busy} onClick={requestCode}>
                {busy ? <span className="spin" /> : "Получить код"}
              </button>
              <p className="small muted" style={{ marginTop: 12 }}>Продолжая, вы соглашаетесь с условиями демонстрационного сервиса. Деньги в приложении условные.</p>
            </>
          ) : (
            <>
              <button className="btn ghost sm" style={{ paddingLeft: 0 }} onClick={() => setStep("phone")}><Icon name="back" size={18} /> Изменить номер</button>
              <h2>Код подтверждения</h2>
              <p className="sub">Отправили на {phone}</p>
              {demoCode && (
                <button className="sms" onClick={() => { setCode(demoCode); if (!isNew || (name.trim().length >= 2 && kind)) void verify(demoCode); }}>
                  <span className="sms-ic"><Icon name="bolt" size={16} /></span>
                  <span className="grow">
                    <b>StepPay</b>
                    <span>Ваш код: <b className="mono">{demoCode}</b></span>
                  </span>
                  <span className="chip">демо, нажмите</span>
                </button>
              )}
              {isNew && (
                <div className="field" style={{ marginTop: 14 }}>
                  <label>Вид участия</label>
                  <div className="kinds">
                    <button type="button" className={`kind ${kind === "customer" ? "on" : ""}`} onClick={() => setKind("customer")}>
                      <Icon name="sprout" size={22} />
                      <b>Заказчик</b>
                      <span>Размещение заказов и оплата по этапам</span>
                    </button>
                    <button type="button" className={`kind ${kind === "executor" ? "on" : ""}`} onClick={() => setKind("executor")}>
                      <Icon name="deals" size={22} />
                      <b>Исполнитель</b>
                      <span>Предоставление услуг и получение выплат</span>
                    </button>
                  </div>
                </div>
              )}
              {isNew && (
                <div className="field" style={{ marginTop: 14 }}>
                  <label>Фамилия и имя</label>
                  <input className="input" autoComplete="name" placeholder="Фамилия и имя" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              )}
              <div className="field" style={{ marginTop: 14 }}>
                <label>Код из SMS</label>
                <input className="input big-input code-input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="······" value={code}
                  onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6 && (!isNew || (name.trim().length >= 2 && kind))) void verify(v); }} />
              </div>
              <button className="btn" style={{ marginTop: 16 }} disabled={busy || code.length !== 6 || (isNew && (name.trim().length < 2 || !kind))} onClick={() => verify()}>
                {busy ? <span className="spin" /> : isNew ? "Зарегистрироваться" : "Войти"}
              </button>
              <button className="btn ghost" disabled={wait > 0 || busy} onClick={requestCode}>{wait > 0 ? `Отправить код повторно через ${wait} с` : "Отправить код повторно"}</button>
            </>
          )}
        </div>

        <Link href="/demo" className="demo-link">
          <span className="grow"><b>Демонстрационный сценарий</b><span>без регистрации</span></span>
          <Icon name="arrow" size={18} />
        </Link>

        {users.length > 0 && (
          <div className="demo-accounts">
            <button className="btn ghost sm" onClick={() => setShowDemo(!showDemo)}>{showDemo ? "Скрыть демо-аккаунты" : "Войти как демо-пользователь"}</button>
            {showDemo && (
              <div className="stack" style={{ marginTop: 8 }}>
                {users.map((u: PublicUser) => (
                  <button key={u.id} className="who" disabled={busy} onClick={() => demoLogin(u.id)}>
                    <Initials name={u.name} />
                    <div className="grow">
                      <div style={{ fontWeight: 700 }}>{u.name}</div>
                      <div className="small" style={{ opacity: 0.8 }}>{ROLE[u.role] ?? "Участник"}</div>
                    </div>
                    <Icon name="arrow" size={18} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
