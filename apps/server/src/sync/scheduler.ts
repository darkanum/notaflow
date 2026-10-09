import type { SyncTargetRepository } from '../repos/SyncTargetRepository';
import type { SyncService } from './SyncService';

export async function runAllOnce(deps: {
  targets: SyncTargetRepository;
  sync: SyncService;
  log?: (message: string, data: object) => void;
}): Promise<void> {
  for (const target of deps.targets.list()) {
    // The scheduler acts for the account itself, not for a person.
    const ctx = {
      accountId: target.accountId,
      userId: 'system',
      role: 'owner' as const,
      accountStatus: target.accountStatus,
    };
    try {
      const result = await deps.sync.syncEmitter(ctx, target.emitterId);
      deps.log?.('sync finished', { emitterId: target.emitterId, ...result });
    } catch (error) {
      deps.log?.('sync skipped', {
        emitterId: target.emitterId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function startScheduler(run: () => Promise<void>, intervalMs: number): { stop(): void } {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    run().finally(() => {
      busy = false;
    });
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
