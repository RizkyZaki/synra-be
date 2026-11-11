import { RuleMetric, Severity, ThresholdOperator } from '@prisma/client';
import { SEVERITY_RANK } from '../assets/asset-status';
import { MSG } from '../../common/constants/messages';

export interface RuleLevel {
  severity: Severity;
  operator: ThresholdOperator;
  value: number;
  enabled: boolean;
  recommendation?: string | null;
}

export const PERCENT_METRICS: RuleMetric[] = [RuleMetric.CPU, RuleMetric.MEMORY, RuleMetric.DISK];

export const METRIC_UNIT: Record<RuleMetric, string> = {
  CPU: '%',
  MEMORY: '%',
  DISK: '%',
  HOST_STALE: 'menit',
  BACKUP_FAILED: 'kali',
  BACKUP_AGE: 'jam',
};

export const DEFAULT_RECOMMENDATION: Record<RuleMetric, string> = {
  CPU: 'Periksa proses dengan konsumsi CPU tertinggi (top/htop) dan job batch yang sedang berjalan. Pertimbangkan penambahan vCPU bila terjadi berulang.',
  MEMORY: 'Periksa proses dengan pemakaian memori terbesar, indikasi memory leak, dan konfigurasi heap aplikasi.',
  DISK: 'Bersihkan log/arsip lama, cari file besar (du -sh), dan rencanakan penambahan kapasitas disk.',
  HOST_STALE: 'Periksa apakah server menyala, koneksi jaringan ke Elasticsearch, serta status layanan Metricbeat/Filebeat di host.',
  BACKUP_FAILED: 'Baca pesan error job backup, cek ruang kosong dan koneksi ke tujuan backup, lalu jalankan ulang job secara manual.',
  BACKUP_AGE: 'Pastikan jadwal job backup (cron/scheduler) masih aktif dan Filebeat mengirim log backup, lalu jalankan backup manual.',
};

/** Nilai default sesuai spesifikasi. "Warning" pada disk dipetakan ke severity LOW. */
export const DEFAULT_RULES: { metric: RuleMetric; levels: Omit<RuleLevel, 'recommendation'>[] }[] = [
  { metric: RuleMetric.CPU, levels: [{ severity: Severity.HIGH, operator: ThresholdOperator.GT, value: 80, enabled: true }] },
  { metric: RuleMetric.MEMORY, levels: [{ severity: Severity.HIGH, operator: ThresholdOperator.GT, value: 85, enabled: true }] },
  {
    metric: RuleMetric.DISK,
    levels: [
      { severity: Severity.LOW, operator: ThresholdOperator.GTE, value: 70, enabled: true },
      { severity: Severity.MEDIUM, operator: ThresholdOperator.GTE, value: 80, enabled: true },
      { severity: Severity.HIGH, operator: ThresholdOperator.GTE, value: 90, enabled: true },
      { severity: Severity.CRITICAL, operator: ThresholdOperator.GTE, value: 95, enabled: true },
    ],
  },
  { metric: RuleMetric.HOST_STALE, levels: [{ severity: Severity.CRITICAL, operator: ThresholdOperator.GT, value: 5, enabled: true }] },
  {
    metric: RuleMetric.BACKUP_FAILED,
    levels: [
      { severity: Severity.HIGH, operator: ThresholdOperator.GTE, value: 1, enabled: true },
      { severity: Severity.CRITICAL, operator: ThresholdOperator.GTE, value: 3, enabled: true },
    ],
  },
  {
    metric: RuleMetric.BACKUP_AGE,
    levels: [
      { severity: Severity.MEDIUM, operator: ThresholdOperator.GT, value: 26, enabled: true },
      { severity: Severity.CRITICAL, operator: ThresholdOperator.GT, value: 50, enabled: true },
    ],
  },
];

/**
 * Memvalidasi satu set level untuk satu metrik. Mengembalikan pesan error (Bahasa Indonesia)
 * atau null bila valid. Level aktif yang diurutkan menurut severity harus bernilai naik tegas.
 */
export function validateLevels(metric: RuleMetric, levels: RuleLevel[]): string | null {
  if (levels.length === 0) return MSG.THRESHOLD_EMPTY;

  const seen = new Set<Severity>();
  for (const l of levels) {
    if (seen.has(l.severity)) return MSG.THRESHOLD_DUPLICATE(metric);
    seen.add(l.severity);
    if (!Number.isFinite(l.value)) return MSG.THRESHOLD_ORDER(metric);
    if (PERCENT_METRICS.includes(metric) && (l.value < 0 || l.value > 100)) {
      return MSG.THRESHOLD_PERCENT_RANGE;
    }
    if (metric === RuleMetric.HOST_STALE && (l.value < 1 || l.value > 1440)) {
      return 'Nilai threshold host stale harus di antara 1 dan 1440 menit.';
    }
    if (metric === RuleMetric.BACKUP_FAILED && (l.value < 1 || l.value > 100)) {
      return 'Nilai threshold backup gagal harus di antara 1 dan 100 kali beruntun.';
    }
    if (metric === RuleMetric.BACKUP_AGE && (l.value < 1 || l.value > 720)) {
      return 'Nilai threshold umur backup harus di antara 1 dan 720 jam.';
    }
  }

  const active = levels
    .filter((l) => l.enabled)
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  for (let i = 1; i < active.length; i++) {
    if (active[i].value <= active[i - 1].value) return MSG.THRESHOLD_ORDER(metric);
  }
  return null;
}

export function compare(value: number, operator: ThresholdOperator, threshold: number): boolean {
  return operator === ThresholdOperator.GTE ? value >= threshold : value > threshold;
}

/** Level dengan severity tertinggi yang terlampaui, atau null. */
export function matchLevel(value: number, levels: RuleLevel[]): RuleLevel | null {
  let best: RuleLevel | null = null;
  for (const l of levels) {
    if (!l.enabled || !compare(value, l.operator, l.value)) continue;
    if (!best || SEVERITY_RANK[l.severity] > SEVERITY_RANK[best.severity]) best = l;
  }
  return best;
}
