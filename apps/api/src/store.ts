import pg from "pg";
import { createState, type State } from "@steppay/engine";
import type { PlatformData } from "./platform";
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
}

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
}

export class PgStore implements Store {
  private pool: Pick<pg.Pool, "query"> & Partial<Pick<pg.Pool, "connect">>;
  private leader?: pg.PoolClient;
  constructor(url: string, pool?: Pick<pg.Pool, "query"> & Partial<Pick<pg.Pool, "connect">>) {
    this.pool =
      pool ??
      new pg.Pool({
        connectionString: url,
        ssl: url.includes("railway.internal") || url.includes("localhost") ? false : { rejectUnauthorized: false },
      });
  }
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
      const r = await client.query("select pg_try_advisory_lock(727001) as ok");
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
    await this.pool.query(
      "create table if not exists files (id text primary key, mime text not null, data bytea not null, created_at timestamptz not null default now())",
    );
    await this.pool.query("alter table files add column if not exists owner_id text");
    await this.pool.query("alter table files add column if not exists private boolean not null default false");
    await this.pool.query(
      "create table if not exists app_state (id int primary key, state jsonb not null, updated_at timestamptz not null default now())",
    );
  }
  async load(): Promise<State> {
    const r = await this.pool.query("select state from app_state where id = 1");
    return (r.rows[0]?.state as State | undefined) ?? createState();
  }
  async save(state: State) {
    await this.pool.query(
      "insert into app_state (id, state) values (1, $1) on conflict (id) do update set state = excluded.state, updated_at = now()",
      [JSON.stringify(state)],
    );
  }
  async loadUsers(): Promise<RegisteredUser[]> {
    const r = await this.pool.query("select state from app_state where id = 2");
    return (r.rows[0]?.state as RegisteredUser[] | undefined) ?? [];
  }
  async saveUsers(users: RegisteredUser[]) {
    await this.pool.query(
      "insert into app_state (id, state) values (2, $1) on conflict (id) do update set state = excluded.state, updated_at = now()",
      [JSON.stringify(users)],
    );
  }
  async loadPlatform(): Promise<PlatformData> {
    const r = await this.pool.query("select state from app_state where id = 3");
    return (r.rows[0]?.state as PlatformData | undefined) ?? { projects: [], services: [], threads: [] };
  }
  async savePlatform(data: PlatformData) {
    await this.pool.query(
      "insert into app_state (id, state) values (3, $1) on conflict (id) do update set state = excluded.state, updated_at = now()",
      [JSON.stringify(data)],
    );
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
