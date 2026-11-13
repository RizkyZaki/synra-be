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

/** Level yang batas harinya bisa diatur, dari yang paling mendesak. */
export const EXPIRY_LEVELS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export type ConfigurableExpiryLevel = (typeof EXPIRY_LEVELS)[number];

/** Batas sisa hari (inklusif) per level, mis. CRITICAL: 30 berarti sisa ≤ 30 hari. */
export type ExpiryThresholds = Record<ConfigurableExpiryLevel, number>;

export const DEFAULT_EXPIRY_THRESHOLDS: ExpiryThresholds = { CRITICAL: 30, HIGH: 90, MEDIUM: 180, LOW: 365 };

export const EXPIRY_DAYS_MAX = 3650;

/**
 * Tingkat urgensi berdasarkan sisa hari. Default: lewat = EXPIRED, ≤30 CRITICAL, ≤90 HIGH,
 * ≤180 MEDIUM, ≤365 LOW, selebihnya INFO. Batasnya bisa diubah admin (lihat ExpiryThreshold).
 */
export function expiryLevel(daysLeft: number, t: ExpiryThresholds = DEFAULT_EXPIRY_THRESHOLDS): ExpiryLevel {
  if (daysLeft < 0) return 'EXPIRED';
  for (const level of EXPIRY_LEVELS) if (daysLeft <= t[level]) return level;
  return 'INFO';
}

/** Mengembalikan pesan error, atau null bila valid. Batas harus naik tegas dari CRITICAL ke LOW. */
export function validateExpiryThresholds(t: ExpiryThresholds): string | null {
  for (const level of EXPIRY_LEVELS) {
    const v = t[level];
    if (!Number.isInteger(v) || v < 0 || v > EXPIRY_DAYS_MAX) {
      return `Batas hari ${level} harus bilangan bulat 0–${EXPIRY_DAYS_MAX}.`;
    }
  }
  for (let i = 1; i < EXPIRY_LEVELS.length; i++) {
    if (t[EXPIRY_LEVELS[i]] <= t[EXPIRY_LEVELS[i - 1]]) {
      return 'Batas hari harus naik berurutan: Critical < High < Medium < Low.';
    }
  }
  return null;
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
