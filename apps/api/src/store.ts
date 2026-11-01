import pg from "pg";
import { createState, type State } from "@steppay/engine";
import type { AuditEvent, ChatMessage, Note, PlatformData, Thread } from "./platform";
import type { RegisteredUser } from "./users";

/** Хранилище целиком держит состояние движка. Для MVP (один инстанс) этого достаточно. */
export interface StoredFile {
  mime: string;
  data: Buffer;
  /** закрытый файл (документы проекта): отдается только владельцу и администраторам */
  private?: boolean;
  ownerId?: string;
}

export interface Store {
  load(): Promise<State>;
  save(state: State): Promise<void>;
  loadUsers(): Promise<RegisteredUser[]>;
  saveUsers(users: RegisteredUser[]): Promise<void>;
  loadPlatform(): Promise<PlatformData>;
  savePlatform(data: PlatformData): Promise<void>;
  putFile(id: string, file: StoredFile): Promise<void>;
  getFile(id: string): Promise<StoredFile | null>;
  /** перезаписывает файл (нужно, чтобы зашифровать файлы, загруженные до включения шифрования) */
  replaceFile(id: string, file: StoredFile): Promise<void>;
  /** закрытые файлы, которые лежат без шифрования */
  plainPrivateFileIds(): Promise<string[]>;
  /** состояние движка в базе изменилось другим экземпляром */
  stale(): Promise<boolean>;
  /** пользователи или данные платформы изменены другим экземпляром */
  auxStale(): Promise<boolean>;
  loadAux(): Promise<{ users: RegisteredUser[]; platform: PlatformData }>;
  /** обмен короткими сообщениями между экземплярами (события для открытых соединений) */
  publish(msg: string): Promise<void>;
  subscribe(cb: (msg: string) => void): Promise<void>;
  /** Аренда фоновой задачи: true, если этот экземпляр теперь ее выполняет (другие экземпляры в это время пропускают). */
  tryLease(name: string, ttlMs: number, owner: string): Promise<boolean>;
  /** коды входа общие для всех экземпляров */
  otpGet(phone: string): Promise<unknown>;
  otpSet(phone: string, value: unknown): Promise<void>;
  otpDel(phone: string): Promise<void>;
}

/** Запись отклонена: состояние в базе изменил другой экземпляр, нужно перечитать и повторить. */
export class StaleError extends Error {}

export class MemoryStore implements Store {
  private state: State = createState();
  async load() {
    return this.state;
  }
  async save(state: State) {
    this.state = state;
  }
  private users: RegisteredUser[] = [];
  async loadUsers() {
    return this.users;
  }
  async saveUsers(users: RegisteredUser[]) {
    this.users = users;
  }
  private platform: PlatformData = { projects: [], services: [], threads: [] };
  async loadPlatform() {
    return this.platform;
  }
  async savePlatform(data: PlatformData) {
    this.platform = data;
  }
  private files = new Map<string, StoredFile>();
  async putFile(id: string, file: StoredFile) {
    this.files.set(id, file);
  }
  async getFile(id: string) {
    return this.files.get(id) ?? null;
  }
  async replaceFile(id: string, file: StoredFile) {
    this.files.set(id, file);
  }
  async plainPrivateFileIds() {
    return [...this.files].filter(([, f]) => f.private && !f.data.subarray(0, 4).equals(Buffer.from("SPE1"))).map(([id]) => id);
  }
  async stale() {
    return false;
  }
  async auxStale() {
    return false;
  }
  async loadAux() {
    return { users: this.users, platform: this.platform };
  }
  async publish() {}
  async subscribe() {}
  async tryLease() {
    return true;
  }
  private otp = new Map<string, unknown>();
  async otpGet(phone: string) {
    return this.otp.get(phone);
  }
  async otpSet(phone: string, value: unknown) {
    this.otp.set(phone, value);
  }
  async otpDel(phone: string) {
    this.otp.delete(phone);
  }
}

const PLATFORM_COLLS = ["projects", "services", "threads", "messages", "reviews", "verifications", "anchors", "audit", "notes", "meta"];

export class PgStore implements Store {
  private pool: Pick<pg.Pool, "query"> & Partial<Pick<pg.Pool, "connect">>;
  private leader?: pg.PoolClient;
  /**
   * schema - отдельная схема Postgres для данных (демо-режим хранит все в схеме demo и не видит рабочих данных).
   * Без нее таблицы лежат в схеме public.
   */
  constructor(url: string, pool?: Pick<pg.Pool, "query"> & Partial<Pick<pg.Pool, "connect">>, private schema?: string) {
    if (schema !== undefined && !/^[a-z_][a-z0-9_]{0,40}$/.test(schema)) throw new Error(`Недопустимое имя схемы базы: ${schema}`);
    this.injected = !!pool;
    this.pool =
      pool ??
      new pg.Pool({
        connectionString: url,
        ssl: url.includes("railway.internal") || url.includes("localhost") ? false : { rejectUnauthorized: false },
        // каждое соединение пула сразу работает в своей схеме
        ...(schema ? { options: `-c search_path=${schema}` } : {}),
      });
  }
  private injected: boolean;
  /**
   * Единственный пишущий экземпляр: состояние держится в памяти, поэтому два процесса, пишущих в одну базу,
   * затирали бы друг друга (в том числе при выкладке новой версии, пока старая еще работает).
   * Блокировка Postgres держится на отдельном соединении и снимается сама, когда процесс завершается.
   */
  async acquireLeader(waitMs = 2000, maxWaitMs = 10 * 60_000): Promise<boolean> {
    if (!this.pool.connect) return true;
    const client = await this.pool.connect();
    const started = Date.now();
    for (;;) {
      const r = await client.query(`select pg_try_advisory_lock(${this.schema ? 727002 : 727001}) as ok`);
      if (r.rows[0]?.ok) {
        this.leader = client;
        return true;
      }
      if (Date.now() - started > maxWaitMs) {
        client.release();
        return false;
      }
      await new Promise((res) => setTimeout(res, waitMs));
    }
  }
  async init() {
    if (this.schema) {
      await this.pool.query(`create schema if not exists ${this.schema}`);
      // переданный снаружи пул (испытания) создан без параметра соединения: переключаем схему запросом
      if (this.injected) await this.pool.query(`set search_path to ${this.schema}`);
    }
    await this.pool.query(
      "create table if not exists files (id text primary key, mime text not null, data bytea not null, created_at timestamptz not null default now())",
    );
    await this.pool.query("alter table files add column if not exists owner_id text");
    await this.pool.query("alter table files add column if not exists private boolean not null default false");
    await this.pool.query(
      "create table if not exists app_state (id int primary key, state jsonb not null, updated_at timestamptz not null default now())",
    );
    await this.pool.query("create table if not exists wallets (user_id text primary key, amount bigint not null)");
    await this.pool.query("create table if not exists deals (id text primary key, data jsonb not null, updated_at timestamptz not null default now())");
    await this.pool.query("create table if not exists docs (coll text not null, key text not null, ord int not null default 0, data jsonb not null, primary key (coll, key))");
    await this.pool.query("create table if not exists ledger (id int primary key, data jsonb not null)");
    // 7 - версия состояния движка (запись только при совпадении), 8 - версия пользователей и платформы
    await this.pool.query("insert into app_state (id, state) values (7, '0'::jsonb), (8, '0'::jsonb) on conflict (id) do nothing");
  }
  private ver?: number;
  private auxVer?: number;
  private async readVer(id: number): Promise<number> {
    const r = await this.pool.query("select state from app_state where id = $1", [id]);
    return Number(r.rows[0]?.state ?? 0);
  }
  async stale() {
    return this.ver !== undefined && (await this.readVer(7)) !== this.ver;
  }
  async auxStale() {
    return this.auxVer !== undefined && (await this.readVer(8)) !== this.auxVer;
  }
  async loadAux() {
    this.auxVer = undefined;
    const users = await this.loadUsers();
    const platform = await this.loadPlatform();
    return { users, platform };
  }
  /** Время берется из базы, поэтому расхождение часов экземпляров не влияет. Аренда сама истекает, если исполнитель завис или упал. */
  async tryLease(name: string, ttlMs: number, owner: string) {
    const r = await this.pool.query(
      `insert into docs (coll, key, data) values ('lease', $1, jsonb_build_object('until', (extract(epoch from clock_timestamp()) * 1000)::bigint + $2::bigint, 'owner', $3::text))
       on conflict (coll, key) do update set data = excluded.data
       where (docs.data->>'until')::bigint < (extract(epoch from clock_timestamp()) * 1000)::bigint
       returning 1`,
      [name, ttlMs, owner],
    );
    return r.rows.length > 0;
  }
  async publish(msg: string) {
    await this.pool.query("select pg_notify('steppay', $1)", [msg]);
  }
  async subscribe(cb: (msg: string) => void) {
    if (!this.pool.connect) return;
    const pool = this.pool as unknown as pg.Pool;
    const open = async (): Promise<void> => {
      try {
        const client = await pool.connect();
        client.on("notification", (m: pg.Notification) => m.payload && cb(m.payload));
        client.on("error", () => {
          client.release(true);
          setTimeout(() => void open(), 3000);
        });
        await client.query("listen steppay");
      } catch {
        setTimeout(() => void open(), 3000);
      }
    };
    await open();
  }
  async otpGet(phone: string) {
    const r = await this.pool.query("select data from docs where coll = 'otp' and key = $1", [phone]);
    return r.rows[0]?.data;
  }
  async otpSet(phone: string, value: unknown) {
    await this.pool.query("insert into docs (coll, key, data) values ('otp', $1, $2) on conflict (coll, key) do update set data = excluded.data", [phone, JSON.stringify(value)]);
  }
  async otpDel(phone: string) {
    await this.pool.query("delete from docs where coll = 'otp' and key = $1", [phone]);
  }
  /** Что уже записано в таблицы: в базу уходят только изменившиеся строки. */
  private saved?: { wallets: Map<string, number>; deals: Map<string, string>; ledger: string[] };

  async load(): Promise<State> {
    const migrated = await this.pool.query("select 1 from app_state where id = 4");
    if (migrated.rows.length === 0) {
      // первый запуск после перехода на таблицы: переносим прежний единый документ
      const old = await this.pool.query("select state from app_state where id = 1");
      this.saved = undefined;
      this.ver = undefined;
      if (old.rows[0]?.state) await this.save(old.rows[0].state as State);
      await this.pool.query("insert into app_state (id, state) values (4, 'true'::jsonb) on conflict (id) do nothing");
    }
    // один запрос: версия и все таблицы читаются из одного снимка базы
    const r = await this.pool.query(
      `select (select state from app_state where id = 7) as v,
              (select coalesce(jsonb_object_agg(user_id, amount), '{}'::jsonb) from wallets) as w,
              (select coalesce(jsonb_object_agg(id, data), '{}'::jsonb) from deals) as d,
              (select coalesce(jsonb_agg(data order by id), '[]'::jsonb) from ledger) as l`,
    );
    const row = r.rows[0] as { v: unknown; w: Record<string, number>; d: State["deals"]; l: State["ledger"] };
    const state: State = createState();
    for (const [k, v] of Object.entries(row.w)) state.wallets[k] = Number(v);
    state.deals = row.d;
    state.ledger = row.l;
    this.ver = Number(row.v ?? 0);
    this.remember(state);
    return state;
  }
  private remember(state: State) {
    this.saved = {
      wallets: new Map(Object.entries(state.wallets)),
      deals: new Map(Object.entries(state.deals).map(([id, d]) => [id, JSON.stringify(d)])),
      ledger: state.ledger.map((e) => JSON.stringify(e)),
    };
  }
  async save(state: State) {
    const prev = this.saved;
    const wallets = Object.entries(state.wallets).filter(([id, v]) => prev?.wallets.get(id) !== v).map(([user_id, amount]) => ({ user_id, amount }));
    const deals: { id: string; data: unknown }[] = [];
    const dealJson = new Map<string, string>();
    for (const [id, d] of Object.entries(state.deals)) {
      const j = JSON.stringify(d);
      dealJson.set(id, j);
      if (prev?.deals.get(id) !== j) deals.push({ id, data: d });
    }
    const ledgerJson = state.ledger.map((e) => JSON.stringify(e));
    // журнал только дописывается; если прежние записи изменились (сброс демо), переписываем его целиком
    const intact = !!prev && prev.ledger.length <= ledgerJson.length && prev.ledger.every((x, i) => x === ledgerJson[i]);
    const from = intact ? prev!.ledger.length : 0;
    const ledger = state.ledger.slice(from).map((e) => ({ id: e.id, data: e }));
    const goneWallets = prev ? [...prev.wallets.keys()].filter((id) => !(id in state.wallets)) : [];
    const goneDeals = prev ? [...prev.deals.keys()].filter((id) => !(id in state.deals)) : [];
    // один оператор с несколькими CTE выполняется в Postgres как одна транзакция;
    // запись проходит, только если версия в базе та же, что мы читали (иначе состояние изменил другой экземпляр)
    const r = await this.pool.query(
      `with v as (update app_state set state = to_jsonb((state#>>'{}')::int + 1), updated_at = now()
                  where id = 7 and ($7::int is null or (state#>>'{}')::int = $7::int) returning (state#>>'{}')::int as n),
            w as (insert into wallets (user_id, amount) select user_id, amount from jsonb_to_recordset($1::jsonb) as x(user_id text, amount bigint)
                  where exists (select 1 from v) on conflict (user_id) do update set amount = excluded.amount returning 1),
            d as (insert into deals (id, data) select id, data from jsonb_to_recordset($2::jsonb) as x(id text, data jsonb)
                  where exists (select 1 from v) on conflict (id) do update set data = excluded.data returning 1),
            l as (insert into ledger (id, data) select id, data from jsonb_to_recordset($3::jsonb) as x(id int, data jsonb)
                  where exists (select 1 from v) on conflict (id) do update set data = excluded.data returning 1),
            dw as (delete from wallets where user_id = any($4::text[]) and exists (select 1 from v) returning 1),
            dd as (delete from deals where id = any($5::text[]) and exists (select 1 from v) returning 1),
            dl as (delete from ledger where id > $6::int and exists (select 1 from v) returning 1)
       select n from v`,
      [JSON.stringify(wallets), JSON.stringify(deals), JSON.stringify(ledger), goneWallets, goneDeals, state.ledger.length, this.ver ?? null],
    );
    if (r.rows.length === 0) throw new StaleError("Состояние изменено другим экземпляром");
    this.ver = Number(r.rows[0]!.n);
    this.saved = { wallets: new Map(Object.entries(state.wallets)), deals: dealJson, ledger: ledgerJson };
  }
  /** Документы пользователей и платформы: что уже записано в таблицу docs (подпись строки по ключу). */
  private docs = new Map<string, string>();
  private docKey = (coll: string, key: string) => `${coll}\u0000${key}`;

  /** Записывает набор документов: меняются только отличающиеся строки, исчезнувшие удаляются. */
  private async syncDocs(colls: string[], rows: { coll: string; key: string; ord: number; data: unknown }[]) {
    const want = new Map<string, string>();
    const changed: typeof rows = [];
    for (const r of rows) {
      const sig = JSON.stringify([r.ord, r.data]);
      const k = this.docKey(r.coll, r.key);
      want.set(k, sig);
      if (this.docs.get(k) !== sig) changed.push(r);
    }
    const gone: { coll: string; key: string }[] = [];
    for (const k of this.docs.keys()) {
      const [coll, key] = k.split("\u0000") as [string, string];
      if (colls.includes(coll) && !want.has(k)) gone.push({ coll, key });
    }
    if (changed.length === 0 && gone.length === 0) return;
    const w = await this.pool.query(
      `with a as (update app_state set state = to_jsonb((state#>>'{}')::int + 1), updated_at = now() where id = 8 returning (state#>>'{}')::int as n),
            u as (insert into docs (coll, key, ord, data) select coll, key, ord, data from jsonb_to_recordset($1::jsonb) as x(coll text, key text, ord int, data jsonb)
                  on conflict (coll, key) do update set ord = excluded.ord, data = excluded.data returning 1),
            d as (delete from docs using jsonb_to_recordset($2::jsonb) as x(coll text, key text) where docs.coll = x.coll and docs.key = x.key returning 1)
       select n from a`,
      [JSON.stringify(changed), JSON.stringify(gone)],
    );
    // свою запись считаем увиденной, только если до нее мы были на актуальной версии
    const n = Number(w.rows[0]?.n);
    if (this.auxVer !== undefined && n === this.auxVer + 1) this.auxVer = n;
    for (const g of gone) this.docs.delete(this.docKey(g.coll, g.key));
    for (const r of changed) this.docs.set(this.docKey(r.coll, r.key), want.get(this.docKey(r.coll, r.key))!);
  }
  private async readDocs(colls: string[]) {
    const v = await this.readVer(8);
    this.auxVer = this.auxVer === undefined ? v : Math.min(this.auxVer, v);
    const r = await this.pool.query("select coll, key, ord, data from docs where coll = any($1::text[]) order by ord, key", [colls]);
    for (const k of [...this.docs.keys()]) if (colls.includes(k.split("\u0000")[0]!)) this.docs.delete(k);
    for (const x of r.rows) this.docs.set(this.docKey(x.coll as string, x.key as string), JSON.stringify([x.ord, x.data]));
    return r.rows as { coll: string; key: string; ord: number; data: unknown }[];
  }
  /** Переносит прежний единый документ (строка app_state) в таблицу docs один раз. */
  private async migrateDocs(oldId: number, markId: number, write: (old: unknown) => Promise<void>) {
    const done = await this.pool.query("select 1 from app_state where id = $1", [markId]);
    if (done.rows.length > 0) return;
    const old = await this.pool.query("select state from app_state where id = $1", [oldId]);
    if (old.rows[0]?.state) await write(old.rows[0].state);
    await this.pool.query("insert into app_state (id, state) values ($1, 'true'::jsonb) on conflict (id) do nothing", [markId]);
  }

  async loadUsers(): Promise<RegisteredUser[]> {
    await this.migrateDocs(2, 5, (old) => this.saveUsers(old as RegisteredUser[]));
    return (await this.readDocs(["user"])).map((r) => r.data as RegisteredUser);
  }
  async saveUsers(users: RegisteredUser[]) {
    await this.syncDocs(["user"], users.map((u, i) => ({ coll: "user", key: u.id, ord: i, data: u })));
  }
  async loadPlatform(): Promise<PlatformData> {
    await this.migrateDocs(3, 6, (old) => this.savePlatform(old as PlatformData));
    const rows = await this.readDocs(PLATFORM_COLLS);
    const list = <T>(coll: string) => rows.filter((r) => r.coll === coll).map((r) => r.data as T);
    const notes: Record<string, Note[]> = {};
    for (const r of rows) if (r.coll === "notes") notes[r.key] = r.data as Note[];
    // сообщения чатов лежат отдельными строками: два экземпляра, пишущих в один чат, не затирают друг друга
    const byThread = new Map<string, ChatMessage[]>();
    for (const r of rows) {
      if (r.coll !== "messages") continue;
      const tid = r.key.slice(0, r.key.indexOf(":"));
      (byThread.get(tid) ?? byThread.set(tid, []).get(tid)!).push(r.data as ChatMessage);
    }
    const threads = list<Thread>("threads").map((th) => {
      const all = [...(th.messages ?? []), ...(byThread.get(th.id) ?? [])];
      const seen = new Set<string>();
      const messages = all.filter((m) => !seen.has(m.id) && !!seen.add(m.id)).sort((a, b) => a.at - b.at);
      return { ...th, messages };
    });
    const out: PlatformData = { projects: list("projects"), services: list("services"), threads, audit: list<AuditEvent>("audit").sort((a, b) => a.at - b.at).map((e, i) => ({ ...e, id: e.id ?? `legacy-${String(i).padStart(9, "0")}` })), anchors: list("anchors"), reviews: list("reviews"), verifications: list("verifications"), notes };
    for (const k of ["notesSeen", "anchorPubs", "mirror"] as const) {
      const v = rows.find((r) => r.coll === "meta" && r.key === k)?.data;
      if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
    }
    return out;
  }
  async savePlatform(data: PlatformData) {
    const rows: { coll: string; key: string; ord: number; data: unknown }[] = [];
    const arr = (coll: string, items: unknown[] | undefined, key: (x: any, i: number) => string) => (items ?? []).forEach((x, i) => rows.push({ coll, key: key(x, i), ord: i, data: x }));
    arr("projects", data.projects, (x) => x.id);
    arr("services", data.services, (x) => x.id);
    arr("threads", data.threads.map(({ messages: _m, ...th }) => th), (x) => x.id);
    for (const th of data.threads) for (const m of th.messages ?? []) rows.push({ coll: "messages", key: `${th.id}:${m.id}`, ord: 0, data: m });
    arr("reviews", data.reviews, (x) => x.id);
    arr("verifications", data.verifications, (x) => x.id);
    arr("anchors", data.anchors, (x) => String(x.n));
    arr("audit", data.audit, (x, i) => x.id ?? `legacy-${String(i).padStart(9, "0")}`);
    for (const [u, n] of Object.entries(data.notes ?? {})) rows.push({ coll: "notes", key: u, ord: 0, data: n });
    for (const k of ["notesSeen", "anchorPubs", "mirror"] as const) if (data[k] !== undefined) rows.push({ coll: "meta", key: k, ord: 0, data: data[k] });
    await this.syncDocs(PLATFORM_COLLS, rows);
  }
  async putFile(id: string, file: StoredFile) {
    await this.pool.query("insert into files (id, mime, data, owner_id, private) values ($1, $2, $3, $4, $5) on conflict do nothing", [id, file.mime, file.data, file.ownerId ?? null, !!file.private]);
  }
  async replaceFile(id: string, file: StoredFile) {
    await this.pool.query("update files set mime = $2, data = $3, owner_id = $4, private = $5 where id = $1", [id, file.mime, file.data, file.ownerId ?? null, !!file.private]);
  }
  async plainPrivateFileIds(): Promise<string[]> {
    const r = await this.pool.query("select id from files where private and substring(data from 1 for 4) <> $1", [Buffer.from("SPE1")]);
    return r.rows.map((x) => x.id as string);
  }
  async getFile(id: string): Promise<StoredFile | null> {
    const r = await this.pool.query("select mime, data, owner_id, private from files where id = $1", [id]);
    const row = r.rows[0];
    return row ? { mime: row.mime as string, data: Buffer.from(row.data as Uint8Array), ownerId: (row.owner_id as string | null) ?? undefined, private: !!row.private } : null;
  }
}
