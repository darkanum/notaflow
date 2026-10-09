import type { FastifyInstance } from 'fastify';
import { accountContext } from '../auth/guards';
import type { Database } from '../db/openDatabase';
import { HttpError } from '../httpError';
import { EmitterRepository } from '../repos/EmitterRepository';
import { SyncStateRepository } from '../repos/SyncStateRepository';
import { SyncBusyError, type SyncService } from '../sync/SyncService';

export function syncRoutes(app: FastifyInstance, deps: { db: Database; sync: SyncService }): void {
  const emitters = new EmitterRepository(deps.db);
  const state = new SyncStateRepository(deps.db);
  const url = '/api/accounts/:accountId/emitters/:emitterId/sync';

  app.get<{ Params: { accountId: string; emitterId: string } }>(url, async (request) => {
    const ctx = accountContext(request, request.params.accountId);
    const emitter = emitters.get(ctx, request.params.emitterId);
    if (!emitter) throw new HttpError(404, 'not_found');
    const row = state.get(ctx, emitter.id, emitter.environment);
    return {
      environment: emitter.environment,
      lastNsu: row.lastNsu,
      lastRunAt: row.lastRunAt,
      lastSuccessAt: row.lastSuccessAt,
      lastError: row.lastError,
      running: deps.sync.isRunning(emitter.id),
    };
  });

  app.post<{ Params: { accountId: string; emitterId: string } }>(url, async (request) => {
    const ctx = accountContext(request, request.params.accountId, { write: true });
    const emitter = emitters.get(ctx, request.params.emitterId);
    if (!emitter) throw new HttpError(404, 'not_found');
    try {
      return await deps.sync.syncEmitter(ctx, emitter.id);
    } catch (error) {
      if (error instanceof SyncBusyError) throw new HttpError(409, 'sync_running');
      throw error;
    }
  });
}
