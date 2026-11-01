"use client";
import { useEffect, useState, type ReactNode } from "react";
import { API_URL, getSiteCode, setSiteCode } from "@/lib/api";

/** Экран кода доступа: показывается, если на сервере задана переменная SITE_ACCESS_CODE. */
export function SiteGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"check" | "open" | "gate">("check");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/site/mode`)
      .then((r) => r.json())
      .then((m: { gate?: boolean }) => setState(m.gate && !getSiteCode() ? "gate" : "open"))
      .catch(() => setState("open"));
    const show = () => setState("gate");
    window.addEventListener("steppay:gate", show);
    return () => window.removeEventListener("steppay:gate", show);
  }, []);

  async function enter() {
    if (!code.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`${API_URL}/site/check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: code.trim() }) });
      if (!r.ok) {
        setError(r.status === 429 ? "Слишком много попыток, подождите минуту" : "Неверный код доступа");
        return;
      }
      setSiteCode(code.trim());
      window.location.reload();
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  if (state === "open") return <>{children}</>;
  if (state === "check") return null;
  return (
    <div className="login">
      <div className="login-panel">
        <div className="auth-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="StepPay" style={{ height: 40, alignSelf: "flex-start" }} />
          <h2 style={{ marginTop: 18 }}>Доступ к сайту</h2>
          <p className="sub">Введите код доступа, который вы получили от команды проекта</p>
          <div className="field" style={{ marginTop: 18 }}>
            <label>Код доступа</label>
            <input className="input big-input" autoFocus autoComplete="off" placeholder="Код доступа" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void enter()} />
          </div>
          {error && <p className="small" style={{ color: "var(--red, #c0392b)", marginTop: 10 }}>{error}</p>}
          <button className="btn" style={{ marginTop: 16 }} disabled={busy || !code.trim()} onClick={() => void enter()}>
            {busy ? <span className="spin" /> : "Войти"}
          </button>
        </div>
      </div>
    </div>
  );
}
