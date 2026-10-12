/**
 * Прикрепляет отчет о прогоне к сделке платформы (нужен токен администратора).
 *   API_URL=https://... ADMIN_TOKEN=... node scripts/attach-report.js reports/sepolia-123.json <id сделки>
 */
const fs = require("node:fs");

async function main() {
  const [file, dealId] = process.argv.slice(2);
  const api = process.env.API_URL ?? "http://localhost:4000";
  const token = process.env.ADMIN_TOKEN;
  if (!file || !dealId || !token) throw new Error("Использование: ADMIN_TOKEN=... node scripts/attach-report.js <отчет.json> <id сделки>");
  const { network, chainId, contract, dealId: chainDeal, explorer, txs } = JSON.parse(fs.readFileSync(file, "utf8"));
  const res = await fetch(`${api}/deals/${encodeURIComponent(dealId)}/chain`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ network, chainId, contract, dealId: chainDeal, explorer, txs }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Ошибка ${res.status}`);
  console.log("Отчет прикреплен к сделке", dealId);
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
