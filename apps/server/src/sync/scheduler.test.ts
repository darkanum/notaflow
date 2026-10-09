import { expect, test, vi } from 'vitest';
import { startScheduler } from './scheduler';

test('runs on every interval and never overlaps a slow run', async () => {
  vi.useFakeTimers();
  let active = 0;
  let maxActive = 0;
  let runs = 0;
  const scheduler = startScheduler(async () => {
    runs++;
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 250));
    active--;
  }, 100);
  await vi.advanceTimersByTimeAsync(1000);
  scheduler.stop();
  vi.useRealTimers();
  expect(maxActive).toBe(1);
  expect(runs).toBeGreaterThanOrEqual(3);
});
