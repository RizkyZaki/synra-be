import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { AlertAction, AlertStatus, AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricsRepository } from '../metrics/metrics.repository';
import { ThresholdsService } from '../thresholds/thresholds.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { evaluateAsset, minutesSinceSeen, staleLimitMinutes } from '../thresholds/threshold-evaluator';
import { dedupKey, planAlertChanges } from './alert-workflow';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';

export interface EvaluationResult {
  assetsEvaluated: number;
  staleAssets: number;
  findings: number;
  created: number;
  updated: number;
  severityRaised: number;
}

const SYSTEM = 'system';

/** Menandai aset stale, mengevaluasi threshold, dan membuat/memperbarui alert (dengan deduplikasi). */
@Injectable()
export class AlertsEngineService {
  private readonly logger = new Logger(AlertsEngineService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsRepository,
    private readonly thresholds: ThresholdsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Dipanggil dari tombol "Evaluasi EWS" (ADMIN). */
  async evaluateManually(actor: AuthUser, meta: RequestMeta): Promise<EvaluationResult> {
    if (this.running) throw new ConflictException(MSG.EVALUATION_RUNNING);
    const result = await this.evaluate();
    await this.audit.log({
      action: AuditAction.ALERT_EVALUATE,
      actorId: actor.id,
      actorUsername: actor.username,
      entity: 'Alert',
      after: { ...result },
      meta,
    });
    return result;
  }

  async evaluate(now = new Date()): Promise<EvaluationResult> {
    if (this.running) {
      this.logger.warn('Evaluasi sebelumnya masih berjalan, dilewati.');
      return { assetsEvaluated: 0, staleAssets: 0, findings: 0, created: 0, updated: 0, severityRaised: 0 };
    }
    this.running = true;
    try {
      return await this.run(now);
    } finally {
      this.running = false;
    }
  }

  private async run(now: Date): Promise<EvaluationResult> {
    const rules = await this.thresholds.rulesByMetric();
    const assets = await this.prisma.asset.findMany();
    const snapshots = await this.metrics.latestSnapshots(assets.map((a) => a.id));

    // 1. Status stale
    const limit = staleLimitMinutes(rules);
    const staleIds = assets.filter((a) => a.isActive && minutesSinceSeen(a, now) > limit).map((a) => a.id);
    await this.prisma.$transaction([
      this.prisma.asset.updateMany({ where: { id: { in: staleIds }, isStale: false }, data: { isStale: true } }),
      this.prisma.asset.updateMany({ where: { id: { notIn: staleIds }, isStale: true }, data: { isStale: false } }),
    ]);

    // 2. Temuan threshold
    const findings = assets.flatMap((a) => {
      const s = snapshots.get(a.id)!;
      return evaluateAsset({ ...a, cpu: s.cpu, memory: s.memory, disks: s.disks }, rules, now);
    });

    // 3. Deduplikasi terhadap alert yang belum CLOSED
    const openAlerts = await this.prisma.alert.findMany({
      where: { status: { not: AlertStatus.CLOSED }, dedupKey: { not: null } },
      select: { id: true, dedupKey: true, severity: true, status: true },
    });
    const statusById = new Map(openAlerts.map((a) => [a.id, a.status]));
    const plan = planAlertChanges(
      findings,
      openAlerts.map((a) => ({ id: a.id, dedupKey: a.dedupKey!, severity: a.severity })),
    );
    const assetById = new Map(assets.map((a) => [a.id, a]));

    let created = 0;
    for (const f of plan.create) {
      const asset = assetById.get(f.assetId)!;
      try {
        const alert = await this.prisma.$transaction(async (tx) => {
          const a = await tx.alert.create({
            data: {
              assetId: f.assetId,
              metric: f.metric,
              label: f.label,
              severity: f.severity,
              dedupKey: dedupKey(f),
              problem: f.problem,
              value: f.value,
              lastValue: f.value,
              thresholdValue: f.threshold,
              picName: asset.picName,
              recommendation: f.recommendation,
              detectedAt: now,
              lastEvaluatedAt: now,
            },
          });
          await tx.alertEvent.create({
            data: { alertId: a.id, action: AlertAction.CREATED, toStatus: AlertStatus.NEW, note: f.problem, actorUsername: SYSTEM },
          });
          return a;
        });
        created++;
        this.notifications.notifyAlert(alert.id, AlertAction.CREATED);
      } catch (e) {
        // Unique dedupKey: proses lain sudah membuat alert untuk kunci yang sama.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }

    let severityRaised = 0;
    for (const u of plan.update) {
      const f = u.finding;
      if (u.raiseSeverity) {
        await this.prisma.$transaction([
          this.prisma.alert.update({
            where: { id: u.alertId },
            data: { severity: f.severity, problem: f.problem, thresholdValue: f.threshold, lastValue: f.value, lastEvaluatedAt: now },
          }),
          this.prisma.alertEvent.create({
            data: {
              alertId: u.alertId,
              action: AlertAction.SEVERITY_RAISED,
              toStatus: statusById.get(u.alertId)!,
              note: `Severity naik menjadi ${f.severity}: ${f.problem}`,
              actorUsername: SYSTEM,
            },
          }),
        ]);
        severityRaised++;
      } else {
        await this.prisma.alert.update({ where: { id: u.alertId }, data: { lastValue: f.value, lastEvaluatedAt: now } });
      }
    }

    // 4. Alert terbuka yang kondisinya tidak lagi ditemukan ditandai pulih (tidak ditutup otomatis:
    //    penutupan tetap oleh manusia dengan catatan). Bila kondisi muncul lagi, penanda dikembalikan.
    const activeIds = plan.update.map((u) => u.alertId);
    await this.prisma.$transaction([
      this.prisma.alert.updateMany({
        where: { status: { not: AlertStatus.CLOSED }, conditionActive: true, id: { notIn: activeIds } },
        data: { conditionActive: false, recoveredAt: now },
      }),
      this.prisma.alert.updateMany({
        where: { id: { in: activeIds }, conditionActive: false },
        data: { conditionActive: true, recoveredAt: null },
      }),
    ]);

    const result = {
      assetsEvaluated: assets.length,
      staleAssets: staleIds.length,
      findings: findings.length,
      created,
      updated: plan.update.length,
      severityRaised,
    };
    if (created > 0 || severityRaised > 0) this.logger.log(`Evaluasi: ${JSON.stringify(result)}`);
    return result;
  }
}
