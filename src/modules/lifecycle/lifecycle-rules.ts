import { LifecycleCategory } from '@prisma/client';

/** Prefix kode item per kategori, mis. LIC-001. */
export const CODE_PREFIX: Record<LifecycleCategory, string> = {
  OS: 'OS',
  LICENSE: 'LIC',
  CERTIFICATE: 'CRT',
  WARRANTY: 'WAR',
  CONTRACT: 'CON',
};

export type ExpiryLevel = 'EXPIRED' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/**
 * Tingkat urgensi berdasarkan sisa hari. Batasnya sama dengan yang dipakai web:
 * lewat = EXPIRED, ≤30 CRITICAL, ≤90 HIGH, ≤180 MEDIUM, ≤365 LOW, selebihnya INFO.
 */
export function expiryLevel(daysLeft: number): ExpiryLevel {
  if (daysLeft < 0) return 'EXPIRED';
  if (daysLeft <= 30) return 'CRITICAL';
  if (daysLeft <= 90) return 'HIGH';
  if (daysLeft <= 180) return 'MEDIUM';
  if (daysLeft <= 365) return 'LOW';
  return 'INFO';
}

/** Tanggal hari ini (YYYY-MM-DD) di zona waktu tertentu. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Selisih hari kalender dari `today` ke `expiry` (keduanya YYYY-MM-DD). Negatif bila sudah lewat. */
export function daysBetween(today: string, expiry: string): number {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** Kolom @db.Date dikembalikan Prisma sebagai Date jam 00:00 UTC. */
export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Kode berikutnya untuk kategori, dari kode-kode yang sudah ada. */
export function nextCode(category: LifecycleCategory, existing: string[]): string {
  const prefix = CODE_PREFIX[category];
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const max = existing.reduce((m, code) => {
    const n = Number(pattern.exec(code)?.[1] ?? 0);
    return n > m ? n : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export function renewalCode(number: number): string {
  return `REQ-${String(number).padStart(3, '0')}`;
}
