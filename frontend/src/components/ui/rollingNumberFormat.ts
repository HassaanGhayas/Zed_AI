export function formatCounter(value: number | null, decimals: number, suffix: string, placeholder: string): string {
  return value === null || !Number.isFinite(value) ? placeholder : `${value.toFixed(decimals)}${suffix}`;
}
