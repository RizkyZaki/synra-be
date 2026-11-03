import { Severity } from '@prisma/client';

export enum AssetStatus {
  ONLINE = 'ONLINE',
  WARNING = 'WARNING',
  CRITICAL = 'CRITICAL',
  STALE = 'STALE',
  INACTIVE = 'INACTIVE',
}

export const SEVERITY_RANK: Record<Severity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function maxSeverity(list: Severity[]): Severity | null {
  return list.reduce<Severity | null>(
    (max, s) => (max === null || SEVERITY_RANK[s] > SEVERITY_RANK[max] ? s : max),
    null,
  );
}

/**
 * Status aset turunan:
 * nonaktif → INACTIVE; tidak ada data > batas stale → STALE;
 * alert terbuka HIGH/CRITICAL → CRITICAL; LOW/MEDIUM → WARNING; selain itu ONLINE.
 */
export function deriveAssetStatus(input: {
  isActive: boolean;
  isStale: boolean;
  openAlertMaxSeverity: Severity | null;
}): AssetStatus {
  if (!input.isActive) return AssetStatus.INACTIVE;
  if (input.isStale) return AssetStatus.STALE;
  const s = input.openAlertMaxSeverity;
  if (s && SEVERITY_RANK[s] >= SEVERITY_RANK.HIGH) return AssetStatus.CRITICAL;
  if (s && SEVERITY_RANK[s] >= SEVERITY_RANK.LOW) return AssetStatus.WARNING;
  return AssetStatus.ONLINE;
}
