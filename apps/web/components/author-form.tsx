"use client";
import { useState } from "react";
import { api, type AuthorProfile } from "@/lib/api";
import { LEGAL_LABEL } from "@/lib/labels";
import { useSession } from "@/lib/session";

/** Анкета автора: статус и ИНН. Нужна один раз, дальше подставляется ко всем проектам. */
export function AuthorForm({ initial, onSaved }: { initial?: AuthorProfile | null; onSaved(a: AuthorProfile): void }) {
  const { toast } = useSession();
  const [a, setA] = useState<AuthorProfile>(initial ?? { legalStatus: "selfemployed", inn: "", orgName: "", email: "" });
  const [busy, setBusy] = useState(false);
  const org = a.legalStatus === "org" || a.legalStatus === "ip";
  const innLen = a.legalStatus === "org" ? 10 : 12;

  async function save() {
    setBusy(true);
    try {
      await api("/me/author", { method: "POST", body: { ...a, orgName: org ? a.orgName : undefined } });
      toast("Анкета сохранена");
      onSaved(a);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="chips">
        {(Object.keys(LEGAL_LABEL) as (keyof typeof LEGAL_LABEL)[]).map((k) => (
          <button key={k} className={`opt ${a.legalStatus === k ? "on" : ""}`} onClick={() => setA({ ...a, legalStatus: k, inn: "" })}>{LEGAL_LABEL[k]}</button>
        ))}
      </div>
      <div className="field">
        <label>ИНН ({innLen} цифр)</label>
        <input className="input mono" inputMode="numeric" maxLength={innLen} value={a.inn} onChange={(e) => setA({ ...a, inn: e.target.value.replace(/\D/g, "") })} placeholder={"0".repeat(innLen)} />
      </div>
      {org && (
        <div className="field">
          <label>{a.legalStatus === "org" ? "Название организации" : "Как записаны в ЕГРИП"}</label>
          <input className="input" value={a.orgName ?? ""} onChange={(e) => setA({ ...a, orgName: e.target.value })} />
        </div>
      )}
      <div className="field">
        <label>Почта для связи</label>
        <input className="input" type="email" value={a.email ?? ""} onChange={(e) => setA({ ...a, email: e.target.value })} placeholder="name@example.com" />
      </div>
      <button className="btn soft" disabled={busy || a.inn.length !== innLen || (org && !a.orgName?.trim())} onClick={save}>Сохранить анкету</button>
    </div>
  );
}
