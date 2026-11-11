import { Injectable } from '@nestjs/common';
import { BackupStatus, Prisma, RuleMetric } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate } from '../../common/dto/pagination.dto';
import { ThresholdsService } from '../thresholds/thresholds.service';
import { BackupJobState, backupAgeHours } from './backup-rules';
import { JobHealth, ListBackupJobsQueryDto, ListBackupRunsQueryDto } from './dto/backup.dto';

/** Job yang tidak melapor lebih lama dari ini dianggap sudah tidak dipakai dan tidak ditampilkan. */
const JOB_WINDOW_DAYS = 30;

interface JobRow {
  assetId: string;
  jobName: string;
  type: string;
  lastStatus: BackupStatus;
  lastRunAt: Date;
  lastSuccessAt: Date | null;
  firstRunAt: Date;
  consecutiveFailures: number;
  lastMessage: string | null;
  lastSizeBytes: bigint | null;
  lastDurationSec: number | null;
  target: string | null;
}

@Injectable()
export class BackupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly thresholds: ThresholdsService,
  ) {}

  /** Keadaan terkini setiap job backup (satu baris per aset + nama job). */
  async jobStates(assetIds?: string[]): Promise<BackupJobState[]> {
    if (assetIds && assetIds.length === 0) return [];
    const assetFilter = assetIds ? Prisma.sql`AND "assetId" IN (${Prisma.join(assetIds)})` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<JobRow[]>`
      WITH recent AS (
        SELECT * FROM "BackupRun"
        WHERE "finishedAt" > now() - make_interval(days => ${JOB_WINDOW_DAYS}::int) ${assetFilter}
      ),
      agg AS (
        SELECT "assetId", "jobName",
          max("finishedAt") FILTER (WHERE status = 'SUCCESS') AS "lastSuccessAt",
          min("finishedAt") AS "firstRunAt"
        FROM recent GROUP BY "assetId", "jobName"
      ),
      last AS (
        SELECT DISTINCT ON ("assetId", "jobName")
          "assetId", "jobName", type, status, "finishedAt", message, "sizeBytes", "durationSec", target
        FROM recent ORDER BY "assetId", "jobName", "finishedAt" DESC
      )
      SELECT l."assetId", l."jobName", l.type, l.status AS "lastStatus", l."finishedAt" AS "lastRunAt",
        a."lastSuccessAt", a."firstRunAt", l.message AS "lastMessage", l."sizeBytes" AS "lastSizeBytes",
        l."durationSec" AS "lastDurationSec", l.target,
        (SELECT count(*) FROM recent r
          WHERE r."assetId" = l."assetId" AND r."jobName" = l."jobName" AND r.status = 'FAILED'
            AND r."finishedAt" > COALESCE(a."lastSuccessAt", '-infinity'::timestamp))::int AS "consecutiveFailures"
      FROM last l JOIN agg a USING ("assetId", "jobName")`;
    return rows.map((r) => ({ ...r, lastSizeBytes: r.lastSizeBytes === null ? null : Number(r.lastSizeBytes) }));
  }

  /** Daftar job beserta status kesehatan, ringkasan, dan aset yang belum punya backup. */
  async listJobs(q: ListBackupJobsQueryDto) {
    const now = new Date();
    const assets = await this.prisma.asset.findMany({
      where: { isActive: true, hostId: q.hostId },
      select: {
        id: true,
        hostname: true,
        ipAddress: true,
        component: true,
        isStale: true,
        host: { select: { id: true, code: true, name: true } },
      },
      orderBy: { hostname: 'asc' },
    });
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const states = await this.jobStates(assets.map((a) => a.id));
    const ageLimit = await this.overdueHours();

    const all = states.map((s) => {
      const ageHours = backupAgeHours(s, now);
      const health: JobHealth =
        s.lastStatus === BackupStatus.FAILED ? 'FAILED' : ageHours > ageLimit ? 'OVERDUE' : 'OK';
      return { ...s, ageHours: Math.round(ageHours * 10) / 10, health, asset: assetById.get(s.assetId)! };
    });

    const search = q.search?.toLowerCase();
    const jobs = all
      .filter((j) => !q.health || j.health === q.health)
      .filter((j) => !search || j.asset.hostname.includes(search) || j.jobName.toLowerCase().includes(search))
      .sort(
        (a, b) =>
          rank(b.health) - rank(a.health) ||
          b.consecutiveFailures - a.consecutiveFailures ||
          a.asset.hostname.localeCompare(b.asset.hostname) ||
          a.jobName.localeCompare(b.jobName),
      );

    const covered = new Set(all.map((j) => j.assetId));
    const since = new Date(now.getTime() - 24 * 3_600_000);
    const last24h = await this.prisma.backupRun.groupBy({
      by: ['status'],
      where: { finishedAt: { gte: since }, assetId: { in: assets.map((a) => a.id) } },
      _count: { _all: true },
      _sum: { sizeBytes: true },
    });
    const count = (s: BackupStatus) => last24h.find((r) => r.status === s)?._count._all ?? 0;

    return {
      summary: {
        jobs: all.length,
        ok: all.filter((j) => j.health === 'OK').length,
        failed: all.filter((j) => j.health === 'FAILED').length,
        overdue: all.filter((j) => j.health === 'OVERDUE').length,
        assetsTotal: assets.length,
        assetsCovered: covered.size,
        runs24h: { success: count(BackupStatus.SUCCESS), failed: count(BackupStatus.FAILED) },
        bytes24h: Number(last24h.reduce((s, r) => s + (r._sum.sizeBytes ?? 0n), 0n)),
        lastRunAt: all.reduce<Date | null>((m, j) => (!m || j.lastRunAt > m ? j.lastRunAt : m), null),
        overdueAfterHours: ageLimit,
      },
      jobs,
      uncovered: assets.filter((a) => !covered.has(a.id)),
    };
  }

  async listRuns(q: ListBackupRunsQueryDto) {
    const where: Prisma.BackupRunWhereInput = { assetId: q.assetId, jobName: q.jobName, status: q.status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.backupRun.findMany({
        where,
        orderBy: { finishedAt: 'desc' },
        skip: q.skip,
        take: q.limit,
        include: { asset: { select: { id: true, hostname: true } } },
      }),
      this.prisma.backupRun.count({ where }),
    ]);
    return paginate(
      rows.map((r) => ({ ...r, sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes) })),
      total,
      q,
    );
  }

  /** Batas "terlambat" = level BACKUP_AGE aktif dengan nilai terkecil (default 26 jam). */
  private async overdueHours(): Promise<number> {
    const rules = await this.thresholds.rulesByMetric();
    const active = (rules[RuleMetric.BACKUP_AGE] ?? []).filter((l) => l.enabled).map((l) => l.value);
    return active.length ? Math.min(...active) : 26;
  }
}

const rank = (h: JobHealth) => (h === 'FAILED' ? 2 : h === 'OVERDUE' ? 1 : 0);
