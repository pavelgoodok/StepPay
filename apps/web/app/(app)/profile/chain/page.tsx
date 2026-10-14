"use client";
import Link from "next/link";
import { CopyText } from "@/components/copy-text";
import { Icon } from "@/components/ui";
import { api, type ChainWallet } from "@/lib/api";
import { rub } from "@/lib/format";
import { usePoll } from "@/lib/session";

/** wei → «0,0030» без потери точности на больших числах */
const eth = (wei: string) => {
  const micro = Number(BigInt(wei) / 10n ** 12n) / 1e6;
  return micro.toLocaleString("ru-RU", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
};

/** Адреса и баланс в сети: открывается по строке «tRUB в сети» на экране кошелька. */
export default function ChainPage() {
  const { data, error } = usePoll(() => api<ChainWallet>("/me/chain"), [], 20_000);
  const w = data && data.enabled ? data : null;
  const link = (path: string) => (w?.explorer ? `${w.explorer}/${path}` : undefined);

  return (
    <div className="page">
      <Link href="/wallet" className="btn ghost sm" style={{ paddingLeft: 0, alignSelf: "flex-start" }}><Icon name="back" size={18} /> Кошелек</Link>
      <h1 className="h1">tRUB в сети</h1>

      {!data && !error && <div className="skeleton" />}
      {error && !data && <div className="note warn">Сеть не отвечает: {error}</div>}
      {data && !data.enabled && <div className="note">Тестовая сеть не подключена к этому серверу.</div>}

      {w && (
        <>
          <div className="card stack">
            <div className="row between">
              <div className="title">На вашем адресе</div>
              <span className="chip">{w.network}</span>
            </div>
            <div className="tiles" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div className="tile"><b className="mono">{rub(w.tokens)}</b><span>токены tRUB</span></div>
              <div className="tile"><b className="mono">{eth(w.eth)}</b><span>ETH на газ</span></div>
            </div>
          </div>

          <div className="card stack">
            <CopyText label="Ваш адрес" value={w.address} href={link(`address/${w.address}`)} />
            <CopyText label="Контракт сделок" value={w.contract} href={link(`address/${w.contract}`)} />
            <CopyText label="Токен tRUB" value={w.token} href={link(`token/${w.token}`)} />
          </div>
        </>
      )}
    </div>
  );
}
