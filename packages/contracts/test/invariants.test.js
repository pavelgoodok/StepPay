const assert = require("node:assert/strict");
const { ethers, Mode, DealStatus, StageStatus, R, DAY, ZERO, hash, deploy, giveTokens, increaseTime } = require("./helpers");

/** Детерминированный генератор случайных чисел: тот же прогон можно повторить. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("StepEscrow: инварианты денег при случайных действиях", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`сценарий ${seed}: токены не создаются и не теряются, резервы согласованы`, async function () {
      const rand = rng(seed);
      const pick = (arr) => arr[Math.floor(rand() * arr.length)];
      const { token, escrow, escrowAddress, signers } = await deploy(19);
      const people = signers.slice(0, 8); // исполнители, заказчики, спонсоры, приемщик
      const arbiter = signers[8];
      const feeTo = signers[19];
      const everyone = [...people, arbiter, feeTo];
      let minted = 0n;
      for (const s of people) {
        await giveTokens(token, escrowAddress, s, 1_000_000n * R);
        minted += 1_000_000n * R;
      }

      // сделки разных режимов
      const deals = [];
      const amountsOf = () => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => BigInt(1 + Math.floor(rand() * 50_000)) * 100n + BigInt(Math.floor(rand() * 100)));
      for (let k = 0; k < 6; k++) {
        const mode = [Mode.Own, Mode.Crowdfunding, Mode.Grant][k % 3];
        const executor = people[k % 2];
        const owner = mode === Mode.Crowdfunding ? ZERO : people[2 + (k % 3)].address;
        const stages = amountsOf();
        const fee = pickFee(rand);
        await escrow.createDeal(mode, executor.address, owner, mode === Mode.Own ? arbiter.address : ZERO, stages, mode === Mode.Grant ? 0 : DAY, fee, hash(`deal${seed}-${k}`));
        deals.push({ id: k + 1, mode, executor, owner: mode === Mode.Crowdfunding ? null : people.find((p) => p.address === owner), stages });
      }
      function pickFee(r) {
        return r() < 0.3 ? Math.floor(r() * 500) : 0;
      }

      const stats = { completed: 0, cancelled: 0, accepted: 0 };
      const attempt = async (fn) => {
        try {
          await (await fn()).wait();
        } catch {
          /* откат допустим: контракт отклонил действие */
        }
      };

      async function checkInvariants(where) {
        const locked = await escrow.totalLocked();
        assert.equal(await token.balanceOf(escrowAddress), locked + (await escrow.totalOwed()), `${where}: баланс контракта не равен резервам плюс долгам`);
        let sum = 0n;
        for (const d of deals) {
          const reserved = await escrow.reservedSum(d.id);
          const info = await escrow.getDeal(d.id);
          const status = Number(info[1]);
          assert.equal(reserved, info[7], `${where}: резервы сделки ${d.id} не сходятся`);
          sum += reserved;
          const st = [];
          for (let i = 0; i < Number(info[8]); i++) st.push(await escrow.getStage(d.id, i));
          const remaining = st.filter((s) => [StageStatus.Pending, StageStatus.Active, StageStatus.Submitted, StageStatus.Disputed].includes(Number(s[1]))).reduce((a, s) => a + s[0], 0n);
          if (status === DealStatus.Completed || status === DealStatus.Cancelled) assert.equal(reserved, 0n, `${where}: в завершенной сделке остались резервы`);
          if (status === DealStatus.Active) assert.equal(reserved, remaining, `${where}: резерв активной сделки не равен остатку этапов`);
          if (status === DealStatus.Funding) assert.ok(reserved <= info[6], `${where}: резерв больше цели`);
          // этапы идут по порядку: принятые, затем не более одного в работе, остальные ждут
          const live = st.filter((s) => [StageStatus.Active, StageStatus.Submitted, StageStatus.Disputed].includes(Number(s[1])));
          assert.ok(live.length <= 1, `${where}: несколько этапов в работе`);
          let seenOpen = false;
          for (const s of st) {
            const v = Number(s[1]);
            if (v !== StageStatus.Accepted) seenOpen = true;
            else assert.ok(!seenOpen, `${where}: принятый этап после непринятого`);
          }
        }
        assert.equal(sum, locked, `${where}: сумма резервов сделок не равна totalLocked`);
        let total = 0n;
        for (const s of everyone) total += await token.balanceOf(s.address);
        total += await token.balanceOf(escrowAddress);
        assert.equal(total, minted, `${where}: токены появились или пропали`);
      }

      for (let step = 0; step < 160; step++) {
        const d = pick(deals);
        const info = await escrow.getDeal(d.id);
        const status = Number(info[1]);
        const live = [];
        for (let i = 0; i < Number(info[8]); i++) {
          const s = await escrow.getStage(d.id, i);
          live.push(Number(s[1]));
        }
        const idx = live.findIndex((s) => [StageStatus.Active, StageStatus.Submitted, StageStatus.Disputed].includes(s));
        const junk = rand() < 0.15; // случайный вызов, чаще всего неверный
        const who = pick(people);
        const label = `шаг ${step}, сделка ${d.id}`;

        if (junk) {
          const c = escrow.connect(who);
          const stage = Math.floor(rand() * 5);
          const act = Math.floor(rand() * 9);
          if (act === 0) await attempt(() => c.fund(d.id, BigInt(1 + Math.floor(rand() * 100_000))));
          else if (act === 1) await attempt(() => c.sign(d.id));
          else if (act === 2) await attempt(() => c.submitStage(d.id, stage, hash("j")));
          else if (act === 3) await attempt(() => c.approveStage(d.id, stage));
          else if (act === 4) await attempt(() => c.rejectStage(d.id, stage, hash("j")));
          else if (act === 5) await attempt(() => c.vote(d.id, stage, rand() < 0.5));
          else if (act === 6) await attempt(() => c.openDispute(d.id, stage, hash("j")));
          else if (act === 7) await attempt(() => c.resolveDispute(d.id, stage, rand() < 0.5));
          else await attempt(() => c.cancel(d.id));
        } else if (status === DealStatus.Funding) {
          const target = info[6];
          if (d.mode === Mode.Crowdfunding) {
            const spons = people.filter((p) => p.address !== d.executor.address);
            const missing = target - info[7];
            if (rand() < 0.6 && missing > 0n) {
              const part = rand() < 0.4 ? missing : 1n + BigInt(Math.floor(rand() * Number(missing)));
              await attempt(() => escrow.connect(pick(spons)).fund(d.id, part));
            } else await attempt(() => escrow.connect(d.executor).sign(d.id));
          } else {
            const r = rand();
            if (r < 0.4) await attempt(() => escrow.connect(d.executor).sign(d.id));
            else if (r < 0.7) await attempt(() => escrow.connect(d.owner).sign(d.id));
            else if (r < 0.95) await attempt(() => escrow.connect(d.owner).fund(d.id, target));
            else await attempt(() => escrow.connect(d.owner).cancel(d.id));
          }
        } else if (status === DealStatus.Active && idx >= 0) {
          const st = live[idx];
          if (st === StageStatus.Active) await attempt(() => escrow.connect(d.executor).submitStage(d.id, idx, hash("e")));
          else if (st === StageStatus.Submitted) {
            const r = rand();
            if (d.mode === Mode.Crowdfunding) {
              const funders = await escrow.fundersOf(d.id);
              const v = people.find((p) => p.address === pick(funders));
              if (r < 0.15) {
                await increaseTime(DAY + 1);
                await attempt(() => escrow.connect(who).autoAccept(d.id, idx));
              } else await attempt(() => escrow.connect(v).vote(d.id, idx, rand() < 0.65));
            } else if (r < 0.5) await attempt(() => escrow.connect(d.owner).approveStage(d.id, idx));
            else if (r < 0.65) await attempt(() => escrow.connect(d.owner).rejectStage(d.id, idx, hash("r")));
            else if (r < 0.75 && d.mode === Mode.Own) await attempt(() => escrow.connect(d.executor).openDispute(d.id, idx, hash("d")));
            else if (r < 0.9 && d.mode === Mode.Own) {
              await increaseTime(DAY + 1);
              await attempt(() => escrow.connect(who).autoAccept(d.id, idx));
            } else await attempt(() => escrow.connect(d.owner).approveStage(d.id, idx));
          } else if (st === StageStatus.Disputed) await attempt(() => escrow.connect(arbiter).resolveDispute(d.id, idx, rand() < 0.5));
        } else if (status === DealStatus.Active && rand() < 0.2) {
          await attempt(() => escrow.connect(d.mode === Mode.Crowdfunding ? d.executor : d.owner).cancel(d.id));
        }
        await checkInvariants(label);
      }

      for (const d of deals) {
        const status = Number((await escrow.getDeal(d.id))[1]);
        if (status === DealStatus.Completed) stats.completed++;
        if (status === DealStatus.Cancelled) stats.cancelled++;
      }
      // сценарий не пустой: хоть что-то дошло до конца
      assert.ok(stats.completed + stats.cancelled > 0, `ни одна сделка не завершилась (${JSON.stringify(stats)})`);
    });
  }
});
