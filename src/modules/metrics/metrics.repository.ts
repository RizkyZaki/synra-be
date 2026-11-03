import { Injectable } from '@nestjs/common';
import { MetricType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface LatestMetricRow {
  assetId: string;
  metric: MetricType;
  label: string;
  value: number;
  timestamp: Date;
}

export interface LatestSnapshot {
  cpu: number | null;
  memory: number | null;
  /** Disk tertinggi di antara semua mount point */
  disk: number | null;
  disks: { mountPoint: string; value: number }[];
  uptimeMs: number | null;
  logErrors: number | null;
  timestamp: Date | null;
}

export interface TrendPoint {
  bucket: Date;
  label: string;
  avg: number;
  max: number;
  min: number;
}

/** Kueri metrik yang dipakai bersama oleh aset, evaluator threshold, dashboard, dan laporan. */
@Injectable()
export class MetricsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Nilai terbaru per (aset, metrik, label) dalam `lookbackHours` terakhir. */
  async latest(assetIds: string[], lookbackHours = 24 * 7): Promise<LatestMetricRow[]> {
    if (assetIds.length === 0) return [];
    return this.prisma.$queryRaw<LatestMetricRow[]>`
      SELECT DISTINCT ON ("assetId", metric, label)
        "assetId", metric, label, value, timestamp
      FROM "Metric"
      WHERE "assetId" IN (${Prisma.join(assetIds)})
        AND timestamp > now() - make_interval(hours => ${lookbackHours}::int)
      ORDER BY "assetId", metric, label, timestamp DESC`;
  }

  /** Ringkasan nilai terbaru per aset. */
  async latestSnapshots(assetIds: string[]): Promise<Map<string, LatestSnapshot>> {
    const rows = await this.latest(assetIds);
    const map = new Map<string, LatestSnapshot>();
    for (const id of assetIds) map.set(id, emptySnapshot());
    for (const r of rows) {
      const s = map.get(r.assetId)!;
      if (!s.timestamp || r.timestamp > s.timestamp) s.timestamp = r.timestamp;
      switch (r.metric) {
        case MetricType.CPU:
          s.cpu = r.value;
          break;
        case MetricType.MEMORY:
          s.memory = r.value;
          break;
        case MetricType.DISK:
          s.disks.push({ mountPoint: r.label, value: r.value });
          s.disk = Math.max(s.disk ?? 0, r.value);
          break;
        case MetricType.UPTIME:
          s.uptimeMs = r.value;
          break;
        case MetricType.LOG_ERROR_COUNT:
          s.logErrors = r.value;
          break;
      }
    }
    for (const s of map.values()) s.disks.sort((a, b) => a.mountPoint.localeCompare(b.mountPoint));
    return map;
  }

  /**
   * Agregasi per bucket waktu. Bila `assetIds` berisi banyak aset, nilai dirata-ratakan lintas aset
   * (dipakai grafik utilisasi dashboard). DISK dikelompokkan per mount point kecuali `mergeLabels`.
   */
  async trend(params: {
    assetIds: string[];
    metric: MetricType;
    from: Date;
    to: Date;
    bucketSeconds: number;
    mergeLabels?: boolean;
  }): Promise<TrendPoint[]> {
    if (params.assetIds.length === 0) return [];
    const labelExpr = params.mergeLabels ? Prisma.sql`''` : Prisma.sql`label`;
    // Untuk DISK gabungan, ambil nilai tertinggi antar-mount per aset dulu agar tidak bias oleh jumlah mount.
    return this.prisma.$queryRaw<TrendPoint[]>`
      SELECT bucket, label, avg(value)::float AS avg, max(value)::float AS max, min(value)::float AS min
      FROM (
        SELECT date_bin(make_interval(secs => ${params.bucketSeconds}::int), timestamp, TIMESTAMPTZ '2000-01-01') AS bucket,
               ${labelExpr} AS label, "assetId", max(value) AS value
        FROM "Metric"
        WHERE "assetId" IN (${Prisma.join(params.assetIds)})
          AND metric = ${params.metric}::"MetricType"
          AND timestamp >= ${params.from} AND timestamp < ${params.to}
        GROUP BY 1, 2, "assetId"
      ) per_asset
      GROUP BY bucket, label
      ORDER BY bucket, label`;
  }

  /**
   * Availability per aset: persentase bucket waktu yang memiliki sampel CPU.
   * Jendela dimulai dari yang paling akhir antara `from` dan awal pemantauan aset
   * (min(didaftarkan, sampel pertama)), dan berakhir di `to` dibatasi data yang sudah di-ingest
   * (`dataUntil`), agar menit yang belum sempat di-ingest tidak dihitung sebagai down.
   */
  async availability(params: {
    assets: { id: string; createdAt: Date }[];
    from: Date;
    to: Date;
    bucketSeconds: number;
    dataUntil?: Date | null;
  }): Promise<Map<string, { upBuckets: number; totalBuckets: number; pct: number | null }>> {
    const result = new Map<string, { upBuckets: number; totalBuckets: number; pct: number | null }>();
    if (params.assets.length === 0) return result;
    const ids = Prisma.join(params.assets.map((a) => a.id));
    const to = new Date(Math.min(params.to.getTime(), params.dataUntil?.getTime() ?? Infinity));

    const [rows, firsts] = await Promise.all([
      this.prisma.$queryRaw<{ assetId: string; up: number }[]>`
        SELECT "assetId",
               count(DISTINCT date_bin(make_interval(secs => ${params.bucketSeconds}::int), timestamp, TIMESTAMPTZ '2000-01-01'))::int AS up
        FROM "Metric"
        WHERE "assetId" IN (${ids})
          AND metric = 'CPU'::"MetricType"
          AND timestamp >= ${params.from} AND timestamp < ${to}
        GROUP BY "assetId"`,
      this.prisma.$queryRaw<{ assetId: string; first: Date }[]>`
        SELECT "assetId", min(timestamp) AS first
        FROM "Metric"
        WHERE "assetId" IN (${ids}) AND metric = 'CPU'::"MetricType"
        GROUP BY "assetId"`,
    ]);
    const up = new Map(rows.map((r) => [r.assetId, r.up]));
    const first = new Map(firsts.map((r) => [r.assetId, r.first]));

    for (const a of params.assets) {
      const monitoringStart = Math.min(a.createdAt.getTime(), first.get(a.id)?.getTime() ?? Infinity);
      const start = Math.max(params.from.getTime(), monitoringStart);
      const total = Math.max(0, Math.ceil((to.getTime() - start) / (params.bucketSeconds * 1000)));
      const upBuckets = Math.min(up.get(a.id) ?? 0, total);
      result.set(a.id, {
        upBuckets,
        totalBuckets: total,
        pct: total === 0 ? null : round2((upBuckets / total) * 100),
      });
    }
    return result;
  }
}

function emptySnapshot(): LatestSnapshot {
  return { cpu: null, memory: null, disk: null, disks: [], uptimeMs: null, logErrors: null, timestamp: null };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Batas data Metricbeat yang sudah di-ingest (cursor), untuk perhitungan availability. */
export async function ingestedUntil(prisma: PrismaService): Promise<Date | null> {
  const states = await prisma.ingestionState.findMany();
  const mb = states.find((s) => s.id.startsWith('metricbeat'));
  return mb?.lastTimestamp ?? null;
}

/** Ukuran bucket otomatis agar grafik berisi ±60–300 titik. */
export function autoBucketSeconds(from: Date, to: Date): number {
  const spanSec = (to.getTime() - from.getTime()) / 1000;
  const candidates = [60, 300, 900, 1800, 3600, 3 * 3600, 6 * 3600, 86400];
  return candidates.find((c) => spanSec / c <= 300) ?? 86400;
}
