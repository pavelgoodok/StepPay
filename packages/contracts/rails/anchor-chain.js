/**
 * Публикация корней якорей StepPay в сеть и сверка. Корни берутся из API платформы (GET /anchors),
 * контракт StepAnchor хранит их в порядке номеров. Приватный ключ издателя нужен только для публикации.
 */

/** Публикует в контракт якоря, которых там еще нет. Возвращает номера записанных. */
async function publishAnchors(contract, anchors) {
  const have = Number(await contract.count());
  const done = [];
  for (const a of anchors.filter((x) => x.n > have).sort((x, y) => x.n - y.n)) {
    await (await contract.anchor(a.n, "0x" + a.root)).wait();
    done.push(a.n);
  }
  return done;
}

/** Сверяет корни платформы с сетью: возвращает список расхождений (пустой, если все совпало). */
async function checkAnchors(contract, anchors) {
  const have = Number(await contract.count());
  const problems = [];
  for (const a of anchors) {
    if (a.n > have) continue; // еще не опубликован, это не расхождение
    const onChain = (await contract.roots(a.n)).slice(2);
    if (onChain !== a.root) problems.push(`якорь №${a.n}: в сети ${onChain.slice(0, 12)}, у платформы ${a.root.slice(0, 12)}`);
  }
  if (anchors.length < have) problems.push(`в сети ${have} якорей, у платформы только ${anchors.length}: история урезана`);
  return problems;
}

module.exports = { publishAnchors, checkAnchors };
