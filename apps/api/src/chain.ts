import { hkdfSync } from "node:crypto";
import { Contract, Interface, JsonRpcProvider, MaxUint256, Wallet, id as keccak, parseEther, type Provider } from "ethers";
import type { Deal, JournalEntry, State } from "@steppay/engine";

/**
 * Зеркало сделок на контракте StepEscrow в тестовой сети.
 *
 * Источником правды остается ядро сделок: оно мгновенно отвечает интерфейсу. Зеркало читает журнал сделки и повторяет каждое
 * действие участника на контракте, а потом сверяет результат (статусы этапов, резервы, остатки). Токены tRUB тестовые.
 * Кошельки участников кастодиальные и тестовые: ключ каждого выводится из секрета сервера и идентификатора пользователя,
 * поэтому ничего не хранится, а подпись транзакции ставит сервер от имени участника. Для настоящих денег такая схема не подходит.
 */

export const ESCROW_ABI = [
  "function createDealFull(uint8 mode, address executor, address owner, address arbiter, uint128[] stageAmounts, uint64 autoAcceptSecs, uint16 feeBps, bytes32 contractHash, tuple(uint64 fundingSecs, uint64 stageSecs, uint64 disputeSecs) deadlines, address backupArbiter) returns (uint256)",
  "function sign(uint256 dealId)",
  "function fund(uint256 dealId, uint256 amount)",
  "function submitStage(uint256 dealId, uint256 stage, bytes32 evidence)",
  "function approveStage(uint256 dealId, uint256 stage)",
  "function rejectStage(uint256 dealId, uint256 stage, bytes32 reason)",
  "function vote(uint256 dealId, uint256 stage, bool accept)",
  "function openDispute(uint256 dealId, uint256 stage, bytes32 reason)",
  "function resolveDispute(uint256 dealId, uint256 stage, bool pay)",
  "function autoAccept(uint256 dealId, uint256 stage)",
  "function cancel(uint256 dealId)",
  "function expireFunding(uint256 dealId)",
  "function expireStage(uint256 dealId, uint256 stage)",
  "function expireDispute(uint256 dealId, uint256 stage)",
  "function getDeal(uint256 dealId) view returns (uint8 mode, uint8 status, address executor, address owner, address arbiter, bytes32 contractHash, uint256 target, uint256 totalReserved, uint256 stageCount)",
  "function getStage(uint256 dealId, uint256 stage) view returns (uint128 amount, uint8 status, uint64 submittedAt, bytes32 evidence)",
  "function reserves(uint256 dealId, address who) view returns (uint256)",
  "function fundersOf(uint256 dealId) view returns (address[])",
  "event DealCreated(uint256 indexed dealId, uint8 mode, address indexed executor, address indexed owner, address arbiter, bytes32 contractHash, uint256 target)",
];
export const TOKEN_ABI = [
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address who) view returns (uint256)",
];

const MODES = { own: 0, crowdfunding: 1, grant: 2 } as const;
const DEAL_STATUS = ["funding", "active", "completed", "cancelled"] as const;
const STAGE_STATUS = ["pending", "active", "submitted", "accepted", "disputed", "failed"] as const;
const PLATFORM = "platform";

export interface ChainInfo {
  network: string;
  chainId: number;
  contract: string;
  token: string;
  explorer?: string;
}

export interface CreateArgs {
  mode: Deal["mode"];
  executor: string;
  owner?: string;
  arbiter?: string;
  backupArbiter?: string;
  stages: number[];
  autoAcceptSecs: number;
  feeBps: number;
  contractHash: string;
  fundingSecs: number;
  stageSecs: number;
  disputeSecs: number;
}

export interface ChainSnapshot {
  status: (typeof DEAL_STATUS)[number];
  stages: (typeof STAGE_STATUS)[number][];
  reserves: Record<string, number>;
  totalReserved: number;
}

export type ChainMethod = "sign" | "fund" | "submitStage" | "approveStage" | "rejectStage" | "vote" | "openDispute" | "resolveDispute" | "autoAccept" | "cancel" | "expireFunding" | "expireStage" | "expireDispute";

/** Порт к сети: все, что нужно зеркалу. Участники названы идентификаторами пользователей платформы, "platform" вызывает общие действия. */
export interface ChainPort {
  info(): ChainInfo;
  addressOf(actor: string): string;
  create(args: CreateArgs): Promise<{ dealId: number; hash: string }>;
  /** подготовить участника к действию: газ, токены на сумму, разрешение контракту тратить токены */
  prepare(actor: string, needTokens?: number): Promise<void>;
  send(actor: string, method: ChainMethod, dealId: number, args: unknown[]): Promise<string>;
  /** адрес, эфир (wei, строкой) и токены tRUB (копейки) участника */
  wallet(actor: string): Promise<{ address: string; eth: string; tokens: number }>;
  /** выпускает тестовые токены на адрес участника, возвращает хеш транзакции */
  faucet(actor: string, amount: number): Promise<string>;
  snapshot(dealId: number, users: string[]): Promise<ChainSnapshot>;
}

export class ChainError extends Error {
  constructor(message: string, readonly retry = false) {
    super(message);
  }
}

const REVERTS: Record<string, string> = {
  BadState: "действие сейчас недоступно контракту (сроки или порядок)",
  Unauthorized: "контракт не признал участника",
  BadInput: "контракт отклонил данные",
};
function reason(e: unknown): string {
  const x = e as { shortMessage?: string; reason?: string; message?: string; revert?: { name?: string }; info?: { error?: { message?: string } } };
  const name = x.revert?.name ?? (/\b(BadState|Unauthorized|BadInput)\b/.exec(`${x.shortMessage ?? ""} ${x.message ?? ""}`)?.[1] as string | undefined);
  if (name && REVERTS[name]) return `${name}: ${REVERTS[name]}`;
  const msg = x.info?.error?.message ?? x.shortMessage ?? x.reason ?? x.message ?? String(e);
  if (/insufficient funds/i.test(msg)) return "не хватает эфира на газ: пополните счет развертывателя из крана тестовой сети";
  return msg.slice(0, 200);
}

export interface EthersChainOptions {
  provider: Provider;
  network: string;
  chainId: number;
  escrow: string;
  token: string;
  deployerKey: string;
  /** секрет, из которого выводятся ключи кошельков участников */
  seed: string;
  explorer?: string;
  /** сколько эфира держать на счете участника для газа */
  gasEth?: string;
}

export class EthersChain implements ChainPort {
  private deployer: Wallet;
  private wallets = new Map<string, Wallet>();
  private iface = new Interface(ESCROW_ABI);
  private gas: bigint;
  private prepared = new Set<string>();

  constructor(private o: EthersChainOptions) {
    this.deployer = new Wallet(o.deployerKey, o.provider);
    this.gas = parseEther(o.gasEth ?? "0.003");
  }

  info(): ChainInfo {
    return { network: this.o.network, chainId: this.o.chainId, contract: this.o.escrow, token: this.o.token, explorer: this.o.explorer };
  }

  /** Ключ участника: HKDF от секрета и идентификатора. Совпадает при каждом запуске, хранить его не нужно. */
  private signer(actor: string): Wallet {
    if (actor === PLATFORM) return this.deployer;
    let w = this.wallets.get(actor);
    if (!w) {
      const key = Buffer.from(hkdfSync("sha256", this.o.seed, "steppay-chain-wallet", `user:${actor}`, 32)).toString("hex");
      w = new Wallet("0x" + key, this.o.provider);
      this.wallets.set(actor, w);
    }
    return w;
  }

  addressOf(actor: string): string {
    return this.signer(actor).address;
  }

  private escrow(w: Wallet) {
    return new Contract(this.o.escrow, ESCROW_ABI, w);
  }
  private token(w: Wallet) {
    return new Contract(this.o.token, TOKEN_ABI, w);
  }

  async prepare(actor: string, needTokens = 0): Promise<void> {
    if (actor === PLATFORM) return;
    const w = this.signer(actor);
    try {
      const eth = await this.o.provider.getBalance(w.address);
      if (eth < this.gas / 2n) await (await this.deployer.sendTransaction({ to: w.address, value: this.gas - eth })).wait();
      if (needTokens > 0) {
        const t = this.token(this.deployer);
        const have = (await t.balanceOf!(w.address)) as bigint;
        if (have < BigInt(needTokens)) await (await t.mint!(w.address, BigInt(needTokens) - have)).wait();
        const allow = (await t.allowance!(w.address, this.o.escrow)) as bigint;
        if (allow < BigInt(needTokens)) await (await this.token(w).approve!(this.o.escrow, MaxUint256)).wait();
      }
    } catch (e) {
      throw new ChainError(`Подготовка кошелька участника: ${reason(e)}`, /timeout|ECONN|network|429|503/i.test(String(e)));
    }
  }

  async create(a: CreateArgs): Promise<{ dealId: number; hash: string }> {
    const zero = "0x0000000000000000000000000000000000000000";
    const addr = (x?: string) => (x ? this.addressOf(x) : zero);
    try {
      const c = this.escrow(this.deployer);
      const tx = await c.createDealFull!(
        MODES[a.mode],
        this.addressOf(a.executor),
        addr(a.owner),
        addr(a.arbiter),
        a.stages.map(BigInt),
        a.autoAcceptSecs,
        a.feeBps,
        a.contractHash,
        [a.fundingSecs, a.stageSecs, a.disputeSecs],
        addr(a.backupArbiter),
      );
      const rc = await tx.wait();
      for (const log of rc?.logs ?? []) {
        const p = this.iface.parseLog(log);
        if (p?.name === "DealCreated") return { dealId: Number(p.args[0]), hash: tx.hash as string };
      }
      throw new Error("в ответе нет события DealCreated");
    } catch (e) {
      throw new ChainError(`Создание сделки: ${reason(e)}`);
    }
  }

  async send(actor: string, method: ChainMethod, dealId: number, args: unknown[]): Promise<string> {
    try {
      const c = this.escrow(this.signer(actor));
      const tx = await (c[method] as (...a: unknown[]) => Promise<{ hash: string; wait(): Promise<unknown> }>)!(dealId, ...args);
      await tx.wait();
      return tx.hash;
    } catch (e) {
      const timeGated = ["autoAccept", "expireFunding", "expireStage", "expireDispute", "resolveDispute"].includes(method);
      const r = reason(e);
      throw new ChainError(`${method}: ${r}`, timeGated && /BadState/.test(r));
    }
  }

  async wallet(actor: string) {
    const address = this.addressOf(actor);
    const [eth, tokens] = await Promise.all([this.o.provider.getBalance(address), this.token(this.deployer).balanceOf!(address) as Promise<bigint>]);
    return { address, eth: eth.toString(), tokens: Number(tokens) };
  }

  async faucet(actor: string, amount: number): Promise<string> {
    try {
      await this.prepare(actor);
      const tx = await this.token(this.deployer).mint!(this.addressOf(actor), BigInt(amount));
      await tx.wait();
      return tx.hash as string;
    } catch (e) {
      throw new ChainError(`Выдача токенов: ${e instanceof ChainError ? e.message : reason(e)}`);
    }
  }

  async snapshot(dealId: number, users: string[]): Promise<ChainSnapshot> {
    const c = this.escrow(this.deployer);
    const d = await c.getDeal!(dealId);
    const stages: ChainSnapshot["stages"] = [];
    for (let i = 0; i < Number(d.stageCount); i++) stages.push(STAGE_STATUS[Number((await c.getStage!(dealId, i)).status)]!);
    const reserves: Record<string, number> = {};
    for (const u of users) reserves[u] = Number(await c.reserves!(dealId, this.addressOf(u)));
    return { status: DEAL_STATUS[Number(d.status)]!, stages, reserves, totalReserved: Number(d.totalReserved) };
  }
}

/** Подключение по адресу узла: для публичной тестовой сети. */
export function chainFromEnv(env: NodeJS.ProcessEnv): ChainPort | undefined {
  const { CHAIN_RPC_URL: rpc, CHAIN_ESCROW: escrow, CHAIN_TOKEN: token, CHAIN_DEPLOYER_KEY: key } = env;
  if (!rpc || !escrow || !token || !key) return undefined;
  const bad: string[] = [];
  if (!/^https?:\/\//.test(rpc.trim())) bad.push("CHAIN_RPC_URL должен начинаться с https://");
  if (!/^0x[0-9a-fA-F]{40}$/.test(escrow.trim())) bad.push("CHAIN_ESCROW: адрес вида 0x и 40 символов");
  if (!/^0x[0-9a-fA-F]{40}$/.test(token.trim())) bad.push("CHAIN_TOKEN: адрес вида 0x и 40 символов");
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key.trim())) bad.push("CHAIN_DEPLOYER_KEY: 64 символа hex, можно с 0x, без пробелов и кавычек");
  if (env.CHAIN_ID && !Number.isInteger(Number(env.CHAIN_ID))) bad.push("CHAIN_ID: число, например 11155111");
  if (Number(env.CHAIN_ID) === 1) bad.push("CHAIN_ID=1 это основная сеть Ethereum: токен тестовый, используйте Sepolia (11155111)");
  if (bad.length) throw new Error(bad.join("; "));
  const chainId = Number(env.CHAIN_ID ?? 11155111);
  const seed = env.CHAIN_WALLET_SEED ?? env.FILE_KEY ?? env.AUTH_SECRET;
  if (!seed) throw new Error("Для сети нужен CHAIN_WALLET_SEED, FILE_KEY или AUTH_SECRET: из него выводятся кошельки участников");
  const provider = new JsonRpcProvider(rpc.trim(), chainId, { staticNetwork: true });
  return new EthersChain({ provider, network: env.CHAIN_NETWORK ?? (chainId === 84532 ? "Base Sepolia" : "Sepolia"), chainId, escrow: escrow.trim(), token: token.trim(), deployerKey: key.trim().startsWith("0x") ? key.trim() : "0x" + key.trim(), seed, explorer: env.CHAIN_EXPLORER ?? (chainId === 11155111 ? "https://sepolia.etherscan.io" : chainId === 84532 ? "https://sepolia.basescan.org" : undefined), gasEth: env.CHAIN_GAS_ETH });
}

// ───────────────────────── зеркало ─────────────────────────

export interface MirrorTx {
  label: string;
  hash: string;
  at: number;
}
export interface MirrorDeal {
  /** номер сделки в контракте */
  id?: number;
  /** сколько записей журнала уже перенесено */
  cursor: number;
  txs: MirrorTx[];
  failed?: string;
  /** сколько раз повторяли действие, зависящее от времени */
  tries?: number;
}
export interface MirrorData {
  /** сделки, созданные раньше этого момента, не зеркалятся */
  since: number;
  deals: Record<string, MirrorDeal>;
}

export type MirrorState = "syncing" | "synced" | "failed";
export interface MirrorVerdict {
  ok: boolean;
  diffs: string[];
}

const rubShort = (k: number) => `${(k / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 }).replace(/[\u00a0\u202f]/g, " ")} ₽`;

export interface MirrorOptions {
  chain: ChainPort;
  data: MirrorData;
  persist: () => Promise<void>;
  now: () => number;
  /** подходит ли сделка для зеркала (демо-сделки не подходят) */
  eligible: (d: Deal) => boolean;
  retryMs?: number;
  maxTries?: number;
  onChange?: (dealId: string) => void;
}

export class ChainMirror {
  private running: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private latest: State | undefined;

  constructor(private o: MirrorOptions) {}

  info() {
    return this.o.chain.info();
  }

  /** Состояние изменилось: перенести новые действия. Не блокирует ответ пользователю. */
  notify(state: State) {
    this.latest = state;
    this.running = this.running.then(() => this.sync()).catch(() => undefined);
  }

  /** Действие со счетом платформы выполняется в общей очереди: иначе номера транзакций (nonce) пересекутся с переносом сделок. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.running.then(fn);
    this.running = run.then(() => undefined, () => undefined);
    return run;
  }

  wallet(userId: string) {
    return this.o.chain.wallet(userId);
  }

  private reconciled = new Map<string, number>();

  /**
   * Баланс в приложении подкреплен токенами на адресе участника. Если токенов меньше, чем свободно в приложении
   * (демо-остаток, выданный до подключения сети), недостающее выпускается. Лишние токены не сжигаются.
   * Пока по сделкам участника есть непереданные в сеть действия, баланс не трогаем: он еще не сошелся.
   */
  reconcile(userId: string, free: number) {
    const t = this.o.now();
    if (t - (this.reconciled.get(userId) ?? 0) < 60_000 || free <= 0) return;
    this.reconciled.set(userId, t);
    void this.exclusive(async () => {
      for (const d of Object.values(this.latest?.deals ?? {})) {
        const mine = d.executorId === userId || d.ownerId === userId || userId in d.contributed || userId in d.reserves;
        const m = this.o.data.deals[d.id];
        if (mine && m && !m.failed && (d.journal?.length ?? 0) > m.cursor) return;
      }
      const w = await this.o.chain.wallet(userId);
      if (w.tokens < free) await this.o.chain.faucet(userId, free - w.tokens);
    }).catch(() => undefined);
  }

  faucet(userId: string, amount: number) {
    return this.exclusive(() => this.o.chain.faucet(userId, amount));
  }

  /** Дождаться, пока все накопленные действия обработаны (нужно тестам и проверкам). */
  idle(): Promise<void> {
    return this.running.then(() => (this.timer ? new Promise<void>((r) => setTimeout(r, 0)) : undefined));
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  state(dealId: string): { state: MirrorState; error?: string; pending: number; txs: number } | undefined {
    const m = this.o.data.deals[dealId];
    const d = this.latest?.deals[dealId];
    if (!m || !d) return undefined;
    const pending = Math.max(0, (d.journal?.length ?? 0) - m.cursor);
    return { state: m.failed ? "failed" : pending > 0 ? "syncing" : "synced", error: m.failed, pending, txs: m.txs.length };
  }

  link(dealId: string): { network: string; chainId: number; contract: string; dealId: number; explorer?: string; txs: MirrorTx[] } | undefined {
    const m = this.o.data.deals[dealId];
    if (!m || m.id === undefined) return undefined;
    const i = this.o.chain.info();
    return { network: i.network, chainId: i.chainId, contract: i.contract, dealId: m.id, explorer: i.explorer, txs: m.txs };
  }

  private async sync() {
    const state = this.latest;
    if (!state) return;
    let retry = false;
    for (const d of Object.values(state.deals)) {
      if (!this.o.eligible(d) || d.createdAt < this.o.data.since) continue;
      const m = (this.o.data.deals[d.id] ??= { cursor: 0, txs: [] });
      if (m.failed) continue;
      const journal = d.journal ?? [];
      while (m.cursor < journal.length) {
        const entry = journal[m.cursor]!;
        try {
          await this.apply(d, m, entry);
          m.cursor++;
          m.tries = 0;
        } catch (e) {
          const err = e instanceof ChainError ? e : new ChainError(reason(e));
          if (err.retry && (m.tries ?? 0) < (this.o.maxTries ?? 20)) {
            m.tries = (m.tries ?? 0) + 1;
            retry = true;
          } else {
            m.failed = `Запись №${entry.n} (${entry.type}): ${err.message}`;
          }
          break;
        }
      }
      await this.o.persist();
      this.o.onChange?.(d.id);
    }
    if (retry && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.running = this.running.then(() => this.sync()).catch(() => undefined);
      }, this.o.retryMs ?? 30_000);
      this.timer.unref?.();
    }
  }

  private async ensureCreated(d: Deal, m: MirrorDeal) {
    if (m.id !== undefined) return;
    if (!d.contract) throw new ChainError("У сделки нет зафиксированного контракта");
    const c = this.o.chain;
    const secs = (ms?: number) => (ms ? Math.max(1, Math.floor(ms / 1000)) : 0);
    const out = await c.create({
      mode: d.mode,
      executor: d.executorId,
      owner: d.mode === "crowdfunding" ? undefined : d.ownerId,
      arbiter: d.mode === "own" ? d.arbiterId : undefined,
      backupArbiter: d.mode === "own" && d.disputeMs ? d.backupArbiterId : undefined,
      stages: d.stages.map((s) => s.amount),
      autoAcceptSecs: d.mode === "grant" ? 0 : Math.max(1, secs(d.autoAcceptMs)),
      feeBps: d.feeBps,
      contractHash: "0x" + d.contract.hash.replace(/^0x/, ""),
      fundingSecs: secs(d.fundingDeadlineMs),
      stageSecs: secs(d.stageDeadlineMs),
      disputeSecs: d.mode === "own" ? secs(d.disputeMs) : 0,
    });
    m.id = out.dealId;
    m.txs.push({ label: "Создание сделки", hash: out.hash, at: Math.floor(this.o.now() / 1000) });
  }

  private async send(m: MirrorDeal, label: string, actor: string, method: ChainMethod, args: unknown[]) {
    const hash = await this.o.chain.send(actor, method, m.id!, args);
    m.txs.push({ label, hash, at: Math.floor(this.o.now() / 1000) });
  }

  /** Переносит одну запись журнала на контракт. Записи, у которых на контракте нет отдельного действия, пропускаются. */
  private async apply(d: Deal, m: MirrorDeal, e: JournalEntry) {
    const idx = e.stageId ? d.stages.findIndex((s) => s.id === e.stageId) : -1;
    const n = idx + 1;
    const data = (e.data ?? {}) as Record<string, unknown>;
    const closedBy = data.closedBy as string | undefined;
    const text = (data.reason as string | undefined) ?? (data.comment as string | undefined) ?? "reason";
    const c = this.o.chain;
    switch (e.type) {
      case "signed":
        await this.ensureCreated(d, m);
        await c.prepare(e.by);
        return this.send(m, "Подпись контракта", e.by, "sign", []);
      case "reserved": {
        await this.ensureCreated(d, m);
        const amount = Number(data.amount);
        await c.prepare(e.by, amount);
        return this.send(m, `Резерв ${rubShort(amount)}`, e.by, "fund", [BigInt(amount)]);
      }
      case "stage_submitted":
        await c.prepare(e.by);
        return this.send(m, `Сдача этапа ${n}`, e.by, "submitStage", [idx, keccak(e.hash)]);
      case "stage_rejected":
        await c.prepare(e.by);
        return this.send(m, `Отказ по этапу ${n}`, e.by, "rejectStage", [idx, keccak(text)]);
      case "dispute_opened":
        await c.prepare(e.by);
        return this.send(m, `Спор по этапу ${n}`, e.by, "openDispute", [idx, keccak(text)]);
      case "vote":
        await c.prepare(e.by);
        return this.send(m, `Голос по этапу ${n}`, e.by, "vote", [idx, data.vote === "accept"]);
      case "stage_accepted":
        if (closedBy === "owner") {
          await c.prepare(e.by);
          return this.send(m, `Приемка этапа ${n}`, e.by, "approveStage", [idx]);
        }
        if (closedBy === "auto") return this.send(m, `Автоприемка этапа ${n}`, PLATFORM, "autoAccept", [idx]);
        if (closedBy === "arbiter") {
          await c.prepare(e.by);
          return this.send(m, `Решение приемщика по этапу ${n}: выплатить`, e.by, "resolveDispute", [idx, true]);
        }
        return; // голосование: этап принял последний голос
      case "stage_failed":
        if (closedBy === "owner") {
          await c.prepare(e.by);
          return this.send(m, `Отказ по этапу ${n}`, e.by, "rejectStage", [idx, keccak(text)]);
        }
        if (closedBy === "arbiter") {
          await c.prepare(e.by);
          return this.send(m, `Решение приемщика по этапу ${n}: вернуть`, e.by, "resolveDispute", [idx, false]);
        }
        if (closedBy === "expired") {
          const disputed = d.stages[idx]?.disputedAt !== undefined;
          return this.send(m, disputed ? `Срок спора по этапу ${n} вышел` : `Срок этапа ${n} вышел`, PLATFORM, disputed ? "expireDispute" : "expireStage", [idx]);
        }
        return; // голосование
      case "funding_expired":
        if (m.id === undefined) return;
        return this.send(m, "Срок сбора вышел", PLATFORM, "expireFunding", []);
      case "cancelled":
        if (m.id === undefined) return;
        await c.prepare(e.by);
        return this.send(m, "Отмена сделки", e.by, "cancel", []);
      default:
        return;
    }
  }

  /** Сверка: то, что видит ядро сделок, должно совпасть с контрактом. */
  async verify(state: State, dealId: string): Promise<MirrorVerdict & { applied: boolean }> {
    const d = state.deals[dealId];
    const m = this.o.data.deals[dealId];
    if (!d || !m || m.id === undefined) return { ok: false, applied: false, diffs: ["Сделка еще не создана на контракте"] };
    const pending = (d.journal?.length ?? 0) - m.cursor;
    const users = [...new Set([d.executorId, d.ownerId, ...Object.keys(d.contributed), ...Object.keys(d.reserves)].filter((x): x is string => !!x))];
    const s = await this.o.chain.snapshot(m.id, users);
    const diffs: string[] = [];
    if (pending > 0) diffs.push(`Не перенесено записей журнала: ${pending}`);
    if (m.failed) diffs.push(m.failed);
    if (!m.failed && pending === 0) {
      const want = d.status === "draft" ? "funding" : d.status;
      if (s.status !== want) diffs.push(`Статус: ядро ${want}, контракт ${s.status}`);
      d.stages.forEach((st, i) => {
        if (s.stages[i] !== st.status) diffs.push(`Этап ${i + 1}: ядро ${st.status}, контракт ${s.stages[i]}`);
      });
      for (const u of users) {
        const a = d.reserves[u] ?? 0;
        const b = s.reserves[u] ?? 0;
        if (a !== b) diffs.push(`Резерв ${u}: ядро ${a}, контракт ${b}`);
      }
      const sum = Object.values(d.reserves).reduce((x, y) => x + y, 0);
      if (sum !== s.totalReserved) diffs.push(`Общий резерв: ядро ${sum}, контракт ${s.totalReserved}`);
    }
    return { ok: diffs.length === 0, applied: pending === 0 && !m.failed, diffs };
  }
}
