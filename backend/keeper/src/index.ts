import { loadConfig } from './config.js';
import { makeClients } from './client.js';
import { startLoop } from './loop.js';
import { log } from './log.js';

const cfg = loadConfig();
const clients = makeClients(cfg);

log.info('keeper: starting', {
  rpc: cfg.rpcUrl,
  chainId: cfg.chainId,
  manager: cfg.manager,
  vault: cfg.vault,
  loopIntervalMs: cfg.loopIntervalMs,
  rebalancePageSize: cfg.rebalancePageSize,
  dryRun: cfg.dryRun,
  signer: clients.account?.address ?? '(read-only)',
});

const stop = startLoop(cfg, clients);

const shutdown = (sig: NodeJS.Signals) => {
  log.info('keeper: shutdown', { sig });
  stop();
  // Give in-flight ticks a moment to flush; viem clients hold no resources.
  setTimeout(() => process.exit(0), 250);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
