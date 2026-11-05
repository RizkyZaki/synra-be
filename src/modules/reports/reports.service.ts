import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, MetricType, Prisma, Severity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MetricsRepository, ingestedUntil, round2 } from '../metrics/metrics.repository';
import { AVAILABILITY_BUCKET_SECONDS } from '../dashboard/dashboard.service';
import { alertCode } from '../notifications/alert-message';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { DailyReportQueryDto, ExportReportQueryDto } from './dto/report.dto';
import { renderPdf, renderXlsx } from './report-renderers';

export interface DailyReport {
  date: string;
  timezone: string;
  generatedAt: Date;
  scope: { host: string | null; component: string | null };
  summary: {
    totalAssets: number;
    availabilityAvgPct: number | null;
    alertsDetected: number;
    alertsClosed: number;
    detectedBySeverity: Record<Severity, number>;
  };
  assets: {
    hostname: string;
    ipAddress: string;
    host: string;
    component: string;
    picName: string;
    cpuAvg: number | null;
    cpuMax: number | null;
    memoryAvg: number | null;
    memoryMax: number | null;
    diskMax: number | null;
    availabilityPct: number | null;
    alertsDetected: number;
  }[];
  alerts: {
    code: string;
    hostname: string;
    host: string;
    problem: string;
    severity: Severity;
    status: string;
    detectedAt: Date;
    closedAt: Date | null;
    closeNote: string | null;
  }[];
}

@Injectable()
export class ReportsService {
  private readonly tz: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsRepository,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.tz = config.get<string>('REPORT_TIMEZONE', 'Asia/Jakarta');
  }

  async daily(q: DailyReportQueryDto): Promise<DailyReport> {
    const date = q.date ?? todayIn(this.tz);
    const { start, end } = dayBounds(date, this.tz);
    if (start.getTime() > Date.now()) throw new BadRequestException('Tanggal laporan tidak boleh di masa depan.');
    const to = new Date(Math.min(end.getTime(), Date.now()));

    const scopeWhere: Prisma.AssetWhereInput = {
      ...(q.hostId ? { hostId: q.hostId } : {}),
      ...(q.component ? { component: q.component } : {}),
    };
    const [assets, host] = await Promise.all([
      this.prisma.asset.findMany({ where: { ...scopeWhere, isActive: true }, include: { host: true }, orderBy: [{ host: { name: 'asc' } }, { hostname: 'asc' }] }),
      q.hostId ? this.prisma.host.findUnique({ where: { id: q.hostId } }) : null,
    ]);
    const ids = assets.map((a) => a.id);

    const [stats, availability, detected, closed] = await Promise.all([
      ids.length
        ? this.prisma.$queryRaw<{ assetId: string; metric: MetricType; avg: number; max: number }[]>`
            SELECT "assetId", metric, avg(value)::float AS avg, max(value)::float AS max
            FROM "Metric"
            WHERE "assetId" IN (${Prisma.join(ids)})
              AND metric IN ('CPU', 'MEMORY', 'DISK')
              AND timestamp >= ${start} AND timestamp < ${end}
            GROUP BY "assetId", metric`
        : [],
      this.metrics.availability({
        assets,
        from: start,
        to,
        bucketSeconds: AVAILABILITY_BUCKET_SECONDS,
        dataUntil: await ingestedUntil(this.prisma),
      }),
      this.prisma.alert.findMany({
        where: { asset: scopeWhere, detectedAt: { gte: start, lt: end } },
        include: { asset: { include: { host: true } } },
        orderBy: { detectedAt: 'asc' },
      }),
      this.prisma.alert.count({ where: { asset: scopeWhere, closedAt: { gte: start, lt: end } } }),
    ]);

    const stat = (assetId: string, metric: MetricType) => stats.find((s) => s.assetId === assetId && s.metric === metric);
    const assetRows = assets.map((a) => ({
      hostname: a.hostname,
      ipAddress: a.ipAddress,
      host: a.host.name,
      component: a.component,
      picName: a.picName,
      cpuAvg: nr(stat(a.id, MetricType.CPU)?.avg),
      cpuMax: nr(stat(a.id, MetricType.CPU)?.max),
      memoryAvg: nr(stat(a.id, MetricType.MEMORY)?.avg),
      memoryMax: nr(stat(a.id, MetricType.MEMORY)?.max),
      diskMax: nr(stat(a.id, MetricType.DISK)?.max),
      availabilityPct: availability.get(a.id)?.pct ?? null,
      alertsDetected: detected.filter((d) => d.assetId === a.id).length,
    }));
    const measured = assetRows.filter((r) => r.availabilityPct !== null);

    return {
      date,
      timezone: this.tz,
      generatedAt: new Date(),
      scope: { host: host?.name ?? null, component: q.component ?? null },
      summary: {
        totalAssets: assets.length,
        availabilityAvgPct: measured.length ? round2(measured.reduce((s, r) => s + r.availabilityPct!, 0) / measured.length) : null,
        alertsDetected: detected.length,
        alertsClosed: closed,
        detectedBySeverity: Object.fromEntries(
          Object.values(Severity).map((s) => [s, detected.filter((d) => d.severity === s).length]),
        ) as Record<Severity, number>,
      },
      assets: assetRows,
      alerts: detected.map((d) => ({
        code: alertCode(d.number),
        hostname: d.asset.hostname,
        host: d.asset.host.name,
        problem: d.problem,
        severity: d.severity,
        status: d.status,
        detectedAt: d.detectedAt,
        closedAt: d.closedAt,
        closeNote: d.closeNote,
      })),
    };
  }

  async export(q: ExportReportQueryDto, actor: AuthUser, meta: RequestMeta) {
    const report = await this.daily(q);
    const buffer = q.format === 'xlsx' ? await renderXlsx(report) : await renderPdf(report);
    await this.audit.log({
      action: AuditAction.REPORT_EXPORT,
      actorId: actor.id,
      actorUsername: actor.username,
      entity: 'Report',
      entityId: `daily:${report.date}`,
      after: { type: 'DAILY', date: report.date, format: q.format, host: report.scope.host, component: report.scope.component },
      meta,
    });
    return {
      buffer,
      fileName: `synra-laporan-harian-${report.date}.${q.format}`,
      contentType:
        q.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
    };
  }
}

function nr(n: number | undefined): number | null {
  return n === undefined ? null : round2(n);
}

export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Awal dan akhir hari kalender `date` (YYYY-MM-DD) pada zona waktu `tz`. */
export function dayBounds(date: string, tz: string): { start: Date; end: Date } {
  const offsetMin = tzOffsetMinutes(new Date(`${date}T12:00:00Z`), tz);
  const startUtc = Date.parse(`${date}T00:00:00Z`) - offsetMin * 60_000;
  if (Number.isNaN(startUtc)) throw new BadRequestException('Tanggal laporan tidak valid.');
  return { start: new Date(startUtc), end: new Date(startUtc + 86_400_000) };
}

function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}
