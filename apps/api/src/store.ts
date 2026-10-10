import pg from "pg";
import { createState, type State } from "@steppay/engine";

/** Хранилище целиком держит состояние движка. Для MVP (один инстанс) этого достаточно. */
export interface StoredFile {
  mime: string;
  data: Buffer;
}

export interface Store {
  load(): Promise<State>;
  save(state: State): Promise<void>;
  putFile(id: string, file: StoredFile): Promise<void>;
  getFile(id: string): Promise<StoredFile | null>;
}

export class MemoryStore implements Store {
  private state: State = createState();
  async load() {
    return this.state;
  }
  async save(state: State) {
    this.state = state;
  }
  private files = new Map<string, StoredFile>();
  async putFile(id: string, file: StoredFile) {
    this.files.set(id, file);
  }
  async getFile(id: string) {
    return this.files.get(id) ?? null;
  }
}

export class PgStore implements Store {
  private pool: pg.Pool;
  constructor(url: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      ssl: url.includes("railway.internal") || url.includes("localhost") ? false : { rejectUnauthorized: false },
    });
  }
  async init() {
    await this.pool.query(
      "create table if not exists files (id text primary key, mime text not null, data bytea not null, created_at timestamptz not null default now())",
    );
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
  async putFile(id: string, file: StoredFile) {
    await this.pool.query("insert into files (id, mime, data) values ($1, $2, $3) on conflict do nothing", [id, file.mime, file.data]);
  }
  async getFile(id: string): Promise<StoredFile | null> {
    const r = await this.pool.query("select mime, data from files where id = $1", [id]);
    return r.rows[0] ? { mime: r.rows[0].mime as string, data: r.rows[0].data as Buffer } : null;
  }
}
