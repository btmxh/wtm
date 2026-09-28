// Deterministic accent hue per oshi name, so each one reads as a distinct
// "binder tab" color across the app without needing manual configuration.
export function oshiHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

export function oshiAccent(name: string): string {
  return `hsl(${oshiHue(name)} 65% 68%)`;
}
