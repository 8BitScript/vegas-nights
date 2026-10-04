// Small shared helpers: power-of-two checks, stable hashing, a seeded PRNG.
import { createHash } from 'node:crypto';

export const isPow2 = (n) => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
export const log2 = (n) => Math.log2(n);

/** JSON with sorted keys, so a spec hashes the same however its keys were written. */
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const hashOf = (value) => createHash('sha256').update(stable(value)).digest('hex').slice(0, 12);

/** mulberry32: a 32-bit seeded generator. Deterministic across machines and Node versions. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const bytesFor = (n) => Math.ceil(Math.log2(n) / 8) || 1;
export const pct = (x, digits = 4) => `${(x * 100).toFixed(digits)}%`;
export const oneIn = (p) => (p > 0 ? Math.round(1 / p).toLocaleString('en-US') : 'never');
