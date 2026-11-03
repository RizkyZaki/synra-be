import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertStatus, IngestSource, MetricType, Severity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AssetsService } from '../assets/assets.service';
import { AlertsService } from '../alerts/alerts.service';
import { MetricsRepository, autoBucketSeconds, ingestedUntil, round2 } from '../metrics/metrics.repository';
import { AssetStatus } from '../assets/asset-status';
import { ScopeFilterDto } from '../../common/dto/scope-filter.dto';
import { resolveRange } from '../../common/dto/date-range.dto';
import { MSG } from '../../common/constants/messages';
import { ScopedRangeDto, TopAlertsQueryDto, TrendQueryDto, UtilizationQueryDto } from './dto/dashboard.dto';

/** Ukuran bucket availability: satu menit (Metricbeat default mengirim tiap 10 detik). */
export const AVAILABILITY_BUCKET_SECONDS = 60;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
    private readonly alerts: AlertsService,
    private readonly metrics: MetricsRepository,
  ) {}

  async summary(scope: ScopeFilterDto) {
    const views = await this.assets.listAll(scope);
    const countStatus = (s: AssetStatus) => views.filter((v) => v.status === s).length;

    const alertWhere = { asset: { ...(scope.bpdId ? { bpdId: scope.bpdId } : {}), ...(scope.component ? { component: scope.component } : {}) } };
    const [byStatus, openBySeverity, lastRun] = await Promise.all([
      this.prisma.alert.groupBy({ by: ['status'], where: alertWhere, _count: true }),
      this.prisma.alert.groupBy({ by: ['severity'], where: { ...alertWhere, status: { not: AlertStatus.CLOSED } }, _count: true }),
      this.prisma.ingestionRun.findFirst({
        where: { source: IngestSource.ELASTICSEARCH, finishedAt: { not: null } },
        orderBy: { startedAt: 'desc' },
        select: { finishedAt: true, error: true },
      }),
    ]);

    const tally = <K extends string>(keys: K[], rows: { _count: number }[], key: (r: never) => K) =>
      Object.fromEntries(keys.map((k) => [k, rows.filter((r) => key(r as never) === k).reduce((n, r) => n + r._count, 0)])) as Record<K, number>;

    const group = (key: (v: (typeof views)[number]) => string) => {
      const m = new Map<string, number>();
      views.forEach((v) => m.set(key(v), (m.get(key(v)) ?? 0) + 1));
      return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    };

    const openBySev = tally(Object.values(Severity), openBySeverity, (r: { severity: Severity }) => r.severity);
    return {
      totalAssets: views.length,
      online: countStatus(AssetStatus.ONLINE),
      warning: countStatus(AssetStatus.WARNING),
      critical: countStatus(AssetStatus.CRITICAL),
      stale: countStatus(AssetStatus.STALE),
      inactive: countStatus(AssetStatus.INACTIVE),
      openAlerts: Object.values(openBySev).reduce((a, b) => a + b, 0),
      openAlertsBySeverity: openBySev,
      alertsByStatus: tally(Object.values(AlertStatus), byStatus, (r: { status: AlertStatus }) => r.status),
      assetsByComponent: group((v) => v.component),
      assetsByBpd: group((v) => v.bpd.name),
      lastIngestAt: lastRun?.finishedAt ?? null,
      lastIngestError: lastRun?.error ?? null,
    };
  }

  async trends(q: TrendQueryDto) {
    const { from, to } = resolveRange(q);
    const bucketSeconds = q.bucketSeconds ?? autoBucketSeconds(from, to);
    let assetIds: string[];
    if (q.assetId) {
      if (!(await this.prisma.asset.findUnique({ where: { id: q.assetId } }))) throw new NotFoundException(MSG.ASSET_NOT_FOUND);
      assetIds = [q.assetId];
    } else {
      assetIds = (await this.scopedAssets(q)).map((a) => a.id);
    }
    const points = await this.metrics.trend({
      assetIds,
      metric: q.metric,
      from,
      to,
      bucketSeconds,
      mergeLabels: !q.assetId,
    });
    const series = new Map<string, { t: Date; avg: number; max: number; min: number }[]>();
    for (const p of points) {
      const list = series.get(p.label) ?? [];
      list.push({ t: p.bucket, avg: round2(p.avg), max: round2(p.max), min: round2(p.min) });
      series.set(p.label, list);
    }
    return {
      metric: q.metric,
      assetId: q.assetId ?? null,
      from,
      to,
      bucketSeconds,
      series: [...series].map(([label, data]) => ({ label, points: data })),
    };
  }

  /** Rata-rata CPU/memori/disk lintas aset per bucket — untuk grafik utilisasi dashboard. */
  async utilization(q: UtilizationQueryDto) {
    const { from, to } = resolveRange(q);
    const bucketSeconds = q.bucketSeconds ?? autoBucketSeconds(from, to);
    const assetIds = (await this.scopedAssets(q)).map((a) => a.id);
    const [cpu, memory, disk] = await Promise.all(
      [MetricType.CPU, MetricType.MEMORY, MetricType.DISK].map((metric) =>
        this.metrics.trend({ assetIds, metric, from, to, bucketSeconds, mergeLabels: true }),
      ),
    );
    const buckets = new Map<number, { t: Date; cpu: number | null; memory: number | null; disk: number | null }>();
    const put = (rows: typeof cpu, key: 'cpu' | 'memory' | 'disk') =>
      rows.forEach((r) => {
        const k = r.bucket.getTime();
        const b = buckets.get(k) ?? { t: r.bucket, cpu: null, memory: null, disk: null };
        b[key] = round2(r.avg);
        buckets.set(k, b);
      });
    put(cpu, 'cpu');
    put(memory, 'memory');
    put(disk, 'disk');
    return { from, to, bucketSeconds, points: [...buckets.values()].sort((a, b) => a.t.getTime() - b.t.getTime()) };
  }

  topAlerts(q: TopAlertsQueryDto) {
    return this.alerts.top(
      { asset: { ...(q.bpdId ? { bpdId: q.bpdId } : {}), ...(q.component ? { component: q.component } : {}) } },
      q.limit,
    );
  }

  async availability(q: ScopedRangeDto) {
    const { from, to } = resolveRange(q);
    const assets = await this.prisma.asset.findMany({
      where: { ...this.scopeWhere(q), isActive: true },
      include: { bpd: { select: { name: true } } },
      orderBy: { hostname: 'asc' },
    });
    const stats = await this.metrics.availability({
      assets,
      from,
      to,
      bucketSeconds: AVAILABILITY_BUCKET_SECONDS,
      dataUntil: await ingestedUntil(this.prisma),
    });
    const rows = assets.map((a) => ({
      assetId: a.id,
      hostname: a.hostname,
      bpd: a.bpd.name,
      component: a.component,
      ...stats.get(a.id)!,
    }));
    const measured = rows.filter((r) => r.pct !== null);
    return {
      from,
      to,
      bucketSeconds: AVAILABILITY_BUCKET_SECONDS,
      averagePct: measured.length ? round2(measured.reduce((s, r) => s + r.pct!, 0) / measured.length) : null,
      assets: rows,
    };
  }

  private scopeWhere(scope: ScopeFilterDto) {
    return { ...(scope.bpdId ? { bpdId: scope.bpdId } : {}), ...(scope.component ? { component: scope.component } : {}) };
  }

  private scopedAssets(scope: ScopeFilterDto) {
    return this.prisma.asset.findMany({ where: { ...this.scopeWhere(scope), isActive: true }, select: { id: true } });
  }
}
