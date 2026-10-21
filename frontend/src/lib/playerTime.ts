/**
 * Quantize a player clock reading to whole seconds so UI state only changes
 * once per second (React bails out of setState when the value is unchanged).
 * Non-finite or negative readings collapse to 0.
 */
export function quantizeSeconds(time: number): number {
  if (!Number.isFinite(time) || time < 0) return 0;
  return Math.floor(time);
}
