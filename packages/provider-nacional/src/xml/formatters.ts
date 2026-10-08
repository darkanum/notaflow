const BRASILIA_OFFSET_MS = 3 * 3_600_000;

export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new RangeError(`Invalid amount in cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

// Brazil has had no daylight saving time since 2019, so Brasília is always UTC-3.
export function formatBrasiliaDateTime(date: Date): string {
  return `${new Date(date.getTime() - BRASILIA_OFFSET_MS).toISOString().slice(0, 19)}-03:00`;
}
