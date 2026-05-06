import type { Config } from '../config.js';
import type { Clients } from '../client.js';
import { VAULT_ABI } from '../abi.js';
import { log } from '../log.js';

/// Counts positions by probing positionIds[0..n] until the call reverts.
/// The vault doesn't expose a length getter; this is the cheapest way.
async function countPositions(
  clients: Clients,
  vault: `0x${string}`,
): Promise<number> {
  let i = 0;
  // Hard cap to avoid runaway probing if state is corrupt; > 1024 is unrealistic
  // and would require an upgrade to a length-aware contract anyway.
  const HARD_CAP = 1024;
  while (i < HARD_CAP) {
    try {
      await clients.publicClient.readContract({
        address: vault,
        abi: VAULT_ABI,
        functionName: 'positionIds',
        args: [BigInt(i)],
      });
      i++;
    } catch {
      return i;
    }
  }
  return i;
}

export async function runRebalance(cfg: Config, clients: Clients): Promise<void> {
  const positions = await countPositions(clients, cfg.vault);
  log.info('rebalance: positions counted', { positions });

  if (positions === 0) {
    log.info('rebalance: skipped — no positions');
    return;
  }

  if (cfg.dryRun) {
    log.info('rebalance: DRY_RUN — skipping submission', { positions });
    return;
  }
  if (!clients.walletClient || !clients.account) {
    log.warn('rebalance: no signing key configured — skipping');
    return;
  }

  const usePaging =
    cfg.rebalancePageSize > 0 && positions > cfg.rebalancePageSize;
  if (!usePaging) {
    await sendOne(cfg, clients, 'rebalance', []);
    return;
  }

  const pages = Math.ceil(positions / cfg.rebalancePageSize);
  log.info('rebalance: paging', { pages, pageSize: cfg.rebalancePageSize });
  for (let p = 0; p < pages; p++) {
    const start = BigInt(p * cfg.rebalancePageSize);
    const count = BigInt(cfg.rebalancePageSize);
    await sendOne(cfg, clients, 'rebalanceBatch', [start, count]);
  }
}

async function sendOne(
  cfg: Config,
  clients: Clients,
  fn: 'rebalance' | 'rebalanceBatch',
  args: readonly bigint[],
): Promise<void> {
  if (!clients.walletClient || !clients.account) return;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const hash = await clients.walletClient.writeContract({
        address: cfg.vault,
        abi: VAULT_ABI,
        functionName: fn,
        args: args as never,
        chain: clients.walletClient.chain,
        account: clients.account,
      });
      log.info('rebalance: tx sent', { fn, hash, attempt });
      const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
      log.info('rebalance: tx confirmed', { fn, hash, status: receipt.status });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('rebalance: tx failed', { fn, attempt, err: msg });
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}
