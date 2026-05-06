import type { Config } from '../config.js';
import type { Clients } from '../client.js';
import { VAULT_ABI } from '../abi.js';
import { log } from '../log.js';

export async function runFulfillQueue(cfg: Config, clients: Clients): Promise<void> {
  const next = (await clients.publicClient.readContract({
    address: cfg.vault,
    abi: VAULT_ABI,
    functionName: 'nextQueueId',
  })) as bigint;

  if (next <= 1n) {
    log.info('fulfillQueue: no entries');
    return;
  }

  const totalQueued = (await clients.publicClient.readContract({
    address: cfg.vault,
    abi: VAULT_ABI,
    functionName: 'totalQueuedPusd',
  })) as bigint;
  if (totalQueued === 0n) {
    log.info('fulfillQueue: totalQueuedPusd == 0; nothing to fill');
    return;
  }

  let attempted = 0;
  let filled = 0;
  for (let id = 1n; id < next; id++) {
    const entry = (await clients.publicClient.readContract({
      address: cfg.vault,
      abi: VAULT_ABI,
      functionName: 'queue',
      args: [id],
    })) as readonly [string, string, boolean, bigint, bigint];
    const pusdOwed = entry[3];
    if (pusdOwed === 0n) continue;

    attempted++;
    if (cfg.dryRun) {
      log.info('fulfillQueue: DRY_RUN — would fulfil', { id: id.toString(), pusdOwed: pusdOwed.toString() });
      continue;
    }
    if (!clients.walletClient || !clients.account) {
      log.warn('fulfillQueue: no signing key — skipping');
      return;
    }

    try {
      const hash = await clients.walletClient.writeContract({
        address: cfg.vault,
        abi: VAULT_ABI,
        functionName: 'fulfillQueueClaim',
        args: [id],
        chain: clients.walletClient.chain,
        account: clients.account,
      });
      const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
      log.info('fulfillQueue: filled', { id: id.toString(), hash, status: receipt.status });
      filled++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn('fulfillQueue: fill reverted (idle short / already filled)', {
        id: id.toString(),
        err: msg,
      });
    }
  }

  log.info('fulfillQueue: done', { attempted, filled });
}
