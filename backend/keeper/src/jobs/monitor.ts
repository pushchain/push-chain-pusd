import type { Config } from '../config.js';
import type { Clients } from '../client.js';
import { VAULT_ABI } from '../abi.js';
import { log } from '../log.js';

export async function runMonitor(cfg: Config, clients: Clients): Promise<void> {
  const [totalAssets, totalQueuedPusd, navE18, paused] = await Promise.all([
    clients.publicClient.readContract({
      address: cfg.vault, abi: VAULT_ABI, functionName: 'totalAssets',
    }),
    clients.publicClient.readContract({
      address: cfg.vault, abi: VAULT_ABI, functionName: 'totalQueuedPusd',
    }),
    clients.publicClient.readContract({
      address: cfg.vault, abi: VAULT_ABI, functionName: 'nav',
    }),
    clients.publicClient.readContract({
      address: cfg.vault, abi: VAULT_ABI, functionName: 'paused',
    }),
  ]);

  log.info('monitor: vault state', {
    totalAssets: (totalAssets as bigint).toString(),
    totalQueuedPusd: (totalQueuedPusd as bigint).toString(),
    nav: (navE18 as bigint).toString(),
    paused,
  });

  // Queue-overflow alert mark from backend.md §F4 — fires when queued PUSD
  // is more than 5% of TVL. Logged here; real alerting plumbing belongs in a
  // separate monitor service.
  const ta = totalAssets as bigint;
  const tq = totalQueuedPusd as bigint;
  if (ta > 0n && (tq * 100n) / ta >= 5n) {
    log.warn('monitor: queue overflow above 5% of TVL', {
      totalQueuedPusd: tq.toString(),
      totalAssets: ta.toString(),
    });
  }
}
