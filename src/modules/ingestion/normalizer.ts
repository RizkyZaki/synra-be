import { MetricType } from '@prisma/client';

export interface NormalizedMetric {
  hostname: string;
  metric: MetricType;
  label: string;
  value: number;
  timestamp: Date;
}

/** Field Metricbeat yang dibaca SYNRA. */
export const METRICBEAT_FIELDS = {
  host: 'host.name',
  cpu: 'system.cpu.total.norm.pct',
  memory: 'system.memory.actual.used.pct',
  disk: 'system.filesystem.used.pct',
  mountPoint: 'system.filesystem.mount_point',
  uptime: 'system.uptime.duration.ms',
} as const;

/**
 * Membaca nilai berdasarkan path bertitik. Mendukung dokumen bersarang ({system:{cpu:...}})
 * maupun field datar ({"system.cpu.total.norm.pct": ...}) dan campurannya.
 */
export function pick(obj: unknown, path: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  const record = obj as Record<string, unknown>;
  if (path in record) return record[path];
  const parts = path.split('.');
  for (let i = parts.length - 1; i > 0; i--) {
    const head = parts.slice(0, i).join('.');
    if (head in record) return pick(record[head], parts.slice(i).join('.'));
  }
  return undefined;
}

function finite(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Metricbeat mengirim persentase sebagai pecahan 0–1. SYNRA menyimpan 0–100 (dibatasi, 2 desimal). */
export function fractionToPercent(v: number): number {
  return Math.round(Math.min(Math.max(v, 0), 1) * 10_000) / 100;
}

export function normalizeHostname(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null;
}

/** Mengubah satu dokumen Metricbeat menjadi nol atau lebih baris metrik. */
export function normalizeMetricbeatDoc(doc: unknown): NormalizedMetric[] {
  const hostname = normalizeHostname(pick(doc, METRICBEAT_FIELDS.host));
  const ts = pick(doc, '@timestamp');
  const timestamp = typeof ts === 'string' || typeof ts === 'number' ? new Date(ts) : null;
  if (!hostname || !timestamp || Number.isNaN(timestamp.getTime())) return [];

  const out: NormalizedMetric[] = [];
  const add = (metric: MetricType, value: number | null, label = '') => {
    if (value !== null) out.push({ hostname, metric, label, value, timestamp });
  };

  const cpu = finite(pick(doc, METRICBEAT_FIELDS.cpu));
  add(MetricType.CPU, cpu === null ? null : fractionToPercent(cpu));

  const mem = finite(pick(doc, METRICBEAT_FIELDS.memory));
  add(MetricType.MEMORY, mem === null ? null : fractionToPercent(mem));

  const disk = finite(pick(doc, METRICBEAT_FIELDS.disk));
  if (disk !== null) {
    const mount = pick(doc, METRICBEAT_FIELDS.mountPoint);
    add(MetricType.DISK, fractionToPercent(disk), typeof mount === 'string' && mount ? mount : '/');
  }

  const uptime = finite(pick(doc, METRICBEAT_FIELDS.uptime));
  add(MetricType.UPTIME, uptime === null || uptime < 0 ? null : Math.round(uptime));

  return out;
}

const CSV_METRIC_ALIASES: Record<string, MetricType> = {
  cpu: MetricType.CPU,
  [METRICBEAT_FIELDS.cpu]: MetricType.CPU,
  memory: MetricType.MEMORY,
  memori: MetricType.MEMORY,
  [METRICBEAT_FIELDS.memory]: MetricType.MEMORY,
  disk: MetricType.DISK,
  [METRICBEAT_FIELDS.disk]: MetricType.DISK,
  uptime: MetricType.UPTIME,
  [METRICBEAT_FIELDS.uptime]: MetricType.UPTIME,
};

export type CsvRowResult = { ok: true; metric: NormalizedMetric } | { ok: false; error: string };

/**
 * Normalisasi satu baris CSV impor. Kolom: hostname, metric, value, timestamp, label (opsional).
 * Nilai CPU/MEMORY/DISK dalam persen 0–100; UPTIME dalam milidetik.
 */
export function normalizeCsvRow(row: Record<string, string | undefined>): CsvRowResult {
  const hostname = normalizeHostname(row.hostname);
  if (!hostname) return { ok: false, error: 'hostname wajib diisi' };

  const metric = CSV_METRIC_ALIASES[(row.metric ?? '').trim().toLowerCase()];
  if (!metric) return { ok: false, error: `metric "${row.metric ?? ''}" tidak dikenal (CPU, MEMORY, DISK, UPTIME)` };

  const value = finite((row.value ?? '').trim().replace(',', '.'));
  if (value === null) return { ok: false, error: 'value harus berupa angka' };
  if (metric === MetricType.UPTIME ? value < 0 : value < 0 || value > 100) {
    return { ok: false, error: metric === MetricType.UPTIME ? 'uptime tidak boleh negatif' : 'value persen harus 0–100' };
  }

  const timestamp = new Date((row.timestamp ?? '').trim());
  if (!row.timestamp || Number.isNaN(timestamp.getTime())) {
    return { ok: false, error: 'timestamp harus berupa tanggal ISO 8601' };
  }
  if (timestamp.getTime() > Date.now() + 5 * 60_000) return { ok: false, error: 'timestamp berada di masa depan' };

  const label = metric === MetricType.DISK ? (row.label ?? '').trim() || '/' : '';
  return {
    ok: true,
    metric: {
      hostname,
      metric,
      label,
      value: metric === MetricType.UPTIME ? Math.round(value) : Math.round(value * 100) / 100,
      timestamp,
    },
  };
}
