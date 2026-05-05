import type { Config } from './config.js';
import type { Clients } from './client.js';
import { runRebalance } from './jobs/rebalance.js';
import { runFulfillQueue } from './jobs/fulfillQueue.js';
import { runMonitor } from './jobs/monitor.js';
import { log } from './log.js';

export async function runOnce(cfg: Config, clients: Clients): Promise<void> {
  const start = Date.now();
  log.info('loop: tick begin', { dryRun: cfg.dryRun });
  try {
    await runRebalance(cfg, clients);
  } catch (err) {
    log.error('loop: rebalance threw', { err: String(err) });
  }
  try {
    await runFulfillQueue(cfg, clients);
  } catch (err) {
    log.error('loop: fulfillQueue threw', { err: String(err) });
  }
  try {
    await runMonitor(cfg, clients);
  } catch (err) {
    log.error('loop: monitor threw', { err: String(err) });
  }
  log.info('loop: tick end', { ms: Date.now() - start });
}

export function startLoop(cfg: Config, clients: Clients): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    await runOnce(cfg, clients);
    if (!stopped) setTimeout(tick, cfg.loopIntervalMs);
  };
  // Fire immediately on boot.
  void tick();
  return () => {
    stopped = true;
  };
}
