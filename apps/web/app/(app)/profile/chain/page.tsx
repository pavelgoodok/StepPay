"use client";
import Link from "next/link";
import { CopyText } from "@/components/copy-text";
import { Icon } from "@/components/ui";
import { api, type ChainWallet } from "@/lib/api";
import { rub } from "@/lib/format";
import { usePoll } from "@/lib/session";

/** wei → «0,0030 ETH» без потери точности на больших числах */
const eth = (wei: string) => {
  const micro = Number(BigInt(wei) / 10n ** 12n) / 1e6;
  return micro.toLocaleString("ru-RU", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
};

/** Кошелек в тестовой сети: не вынесен в меню, открывается ссылкой внизу профиля. */
export default function ChainPage() {
    const { data, error } = usePoll(() => api<ChainWallet>("/me/chain"), [], 20_000);
  const w = data && data.enabled ? data : null;
  const link = (path: string) => (w?.explorer ? `${w.explorer}/${path}` : undefined);

  return (
    <div className="page">
      <Link href="/wallet" className="btn ghost sm" style={{ paddingLeft: 0, alignSelf: "flex-start" }}><Icon name="back" size={18} /> Кошелек</Link>
      <h1 className="h1">Токены tRUB в сети</h1>
      <p className="sub">Баланс вашего кошелька хранится тестовыми токенами tRUB. Здесь адрес, контракты и объяснение, откуда берутся токены. Они ничего не стоят.</p>

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
            <Link href="/wallet" className="btn soft">Пополнить в кошельке</Link>
          </div>

          <div className="card stack">
            <div className="title">Как появляются токены</div>
            <ol className="stack" style={{ gap: 10, paddingLeft: 18, margin: 0 }}>
              <li className="sub">tRUB это тестовая монета. Ее никто не покупает: контракт токена позволяет платформе выпускать ее на любой адрес.</li>
              <li className="sub">Когда вы пополняете кошелек, платформа выпускает на ваш адрес столько же токенов, и только потом растет баланс в приложении. Перед резервом по сделке недостающее добирается само, и контракту сделок разрешается списать сумму взноса.</li>
                            <li className="sub">Дальше токены двигает контракт: резерв уходит с вашего адреса на контракт, выплата за принятый этап уходит исполнителю, остаток при отмене возвращается назад.</li>
              <li className="sub">Баланс кошелька в приложении и токены на адресе должны совпадать: приложение сверяет их и показывает «Совпадает» на экране кошелька.</li>
            </ol>
          </div>

          <div className="card stack">
            <div className="title">Ваш адрес</div>
            <CopyText value={w.address} href={link(`address/${w.address}`)} />
            <div className="small muted">Ключ этого адреса выводится из секрета сервера и вам не передается: подписывает транзакции сервер. Так устроен тест, для настоящих денег нужны ключи у владельцев.</div>
          </div>

          <div className="card stack">
            <div className="title">Контракты</div>
            <CopyText label="Контракт сделок StepEscrow" value={w.contract} href={link(`address/${w.contract}`)} />
            <CopyText label="Токен tRUB" value={w.token} href={link(`token/${w.token}`)} />
            <div className="small muted">Чтобы увидеть токен в MetaMask: Импорт токенов, адрес токена, символ tRUB, знаков после запятой 2. Адрес MetaMask должен совпадать с вашим адресом выше, а токены в нем появятся только на нем.</div>
          </div>
        </>
      )}
    </div>
  );
}
