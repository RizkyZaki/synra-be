import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AlertAction, AlertStatus, AuditAction, Severity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { SEVERITY_RANK } from '../assets/asset-status';
import { alertCode } from '../notifications/alert-message';
import { UpdateEscalationPolicyDto } from './dto/escalation.dto';
import { DEFAULT_POLICIES, nextEscalation, PolicyRule, slaState, validatePolicy } from './escalation-rules';

const STATUS_LABEL: Record<AlertStatus, string> = {
  NEW: 'Baru (belum diakui)',
  ACKNOWLEDGED: 'Diakui',
  IN_PROGRESS: 'Dalam penanganan',
  PENDING_REVIEW: 'Menunggu review',
  CLOSED: 'Ditutup',
};

@Injectable()
export class EscalationService implements OnModuleInit {
  private readonly logger = new Logger(EscalationService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Mengisi matriks default untuk severity yang belum punya kebijakan. */
  async onModuleInit() {
    const existing = new Set((await this.prisma.escalationPolicy.findMany({ select: { severity: true } })).map((p) => p.severity));
    const missing = DEFAULT_POLICIES.filter((p) => !existing.has(p.severity));
    for (const p of missing) {
      await this.prisma.escalationPolicy.create({
        data: {
          severity: p.severity,
          ackMinutes: p.ackMinutes,
          resolveMinutes: p.resolveMinutes,
          enabled: p.enabled,
          steps: { create: p.steps.map((s) => ({ level: s.level, afterMinutes: s.afterMinutes, targetLabel: s.targetLabel })) },
        },
      });
    }
    if (missing.length) this.logger.log(`Matriks eskalasi default dibuat untuk: ${missing.map((p) => p.severity).join(', ')}.`);
  }

  async policies(): Promise<PolicyRule[]> {
    const rows = await this.prisma.escalationPolicy.findMany({ include: { steps: { orderBy: { level: 'asc' } } } });
    return rows
      .map((r) => ({
        severity: r.severity,
        ackMinutes: r.ackMinutes,
        resolveMinutes: r.resolveMinutes,
        enabled: r.enabled,
        updatedAt: r.updatedAt,
        steps: r.steps.map((s) => ({
          level: s.level,
          afterMinutes: s.afterMinutes,
          targetLabel: s.targetLabel,
          mention: s.mention,
          telegramChatId: s.telegramChatId,
        })),
      }))
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  }

  async update(severity: Severity, dto: UpdateEscalationPolicyDto, actor: AuthUser, meta: RequestMeta) {
    const steps = dto.steps.map((s, i) => ({
      level: i + 1,
      afterMinutes: s.afterMinutes,
      targetLabel: s.targetLabel,
      mention: s.mention ?? null,
      telegramChatId: s.telegramChatId ?? null,
    }));
    const error = validatePolicy({ ackMinutes: dto.ackMinutes, resolveMinutes: dto.resolveMinutes, steps });
    if (error) throw new BadRequestException(error);

    const before = (await this.policies()).find((p) => p.severity === severity) ?? null;
    await this.prisma.$transaction(async (tx) => {
      await tx.escalationPolicy.upsert({
        where: { severity },
        create: { severity, ackMinutes: dto.ackMinutes, resolveMinutes: dto.resolveMinutes, enabled: dto.enabled, updatedById: actor.id },
        update: { ackMinutes: dto.ackMinutes, resolveMinutes: dto.resolveMinutes, enabled: dto.enabled, updatedById: actor.id },
      });
      await tx.escalationStep.deleteMany({ where: { severity } });
      if (steps.length) await tx.escalationStep.createMany({ data: steps.map((s) => ({ severity, ...s })) });
      await this.audit.log(
        {
          action: AuditAction.ESCALATION_UPDATE,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'EscalationPolicy',
          entityId: severity,
          before: before ? JSON.parse(JSON.stringify(before)) : undefined,
          after: { severity, ackMinutes: dto.ackMinutes, resolveMinutes: dto.resolveMinutes, enabled: dto.enabled, steps },
          meta,
        },
        tx,
      );
    });
    return (await this.policies()).find((p) => p.severity === severity);
  }

  /** Alert terbuka beserta tenggat SLA dan posisi eskalasinya, ditambah kepatuhan SLA 30 hari. */
  async active(now = new Date()) {
    const policies = new Map((await this.policies()).map((p) => [p.severity, p]));
    const open = await this.prisma.alert.findMany({
      where: { status: { not: AlertStatus.CLOSED } },
      include: { asset: { select: { id: true, hostname: true, host: { select: { code: true, name: true } } } } },
    });

    const items = open.map((a) => {
      const policy = policies.get(a.severity);
      const sla = policy ? slaState(a, policy, now) : null;
      const current = policy?.steps.find((s) => s.level === a.escalationLevel) ?? null;
      const next = policy?.enabled ? policy.steps.find((s) => s.level > a.escalationLevel) ?? null : null;
      return {
        id: a.id,
        code: alertCode(a.number),
        severity: a.severity,
        status: a.status,
        problem: a.problem,
        conditionActive: a.conditionActive,
        detectedAt: a.detectedAt,
        acknowledgedAt: a.acknowledgedAt,
        asset: a.asset,
        escalationLevel: a.escalationLevel,
        lastEscalatedAt: a.lastEscalatedAt,
        currentTarget: current?.targetLabel ?? null,
        next: next
          ? { level: next.level, targetLabel: next.targetLabel, at: new Date(a.detectedAt.getTime() + next.afterMinutes * 60_000) }
          : null,
        ...(sla ?? { ackDueAt: null, resolveDueAt: null, ackBreached: false, resolveBreached: false }),
      };
    });
    items.sort(
      (a, b) =>
        Number(b.resolveBreached || b.ackBreached) - Number(a.resolveBreached || a.ackBreached) ||
        b.escalationLevel - a.escalationLevel ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        a.detectedAt.getTime() - b.detectedAt.getTime(),
    );

    // Kepatuhan SLA untuk alert yang ditutup dalam 30 hari terakhir.
    const closed = await this.prisma.alert.findMany({
      where: { status: AlertStatus.CLOSED, closedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } },
      select: { severity: true, status: true, conditionActive: true, detectedAt: true, acknowledgedAt: true, closedAt: true, escalationLevel: true },
    });
    let ackMet = 0;
    let resolveMet = 0;
    let measured = 0;
    for (const a of closed) {
      const policy = policies.get(a.severity);
      if (!policy) continue;
      const s = slaState(a, policy, now);
      measured++;
      if (!s.ackBreached) ackMet++;
      if (!s.resolveBreached) resolveMet++;
    }
    const pct = (n: number) => (measured ? Math.round((n / measured) * 1000) / 10 : null);

    return {
      summary: {
        open: items.length,
        escalated: items.filter((i) => i.escalationLevel > 0).length,
        ackBreached: items.filter((i) => i.ackBreached).length,
        resolveBreached: items.filter((i) => i.resolveBreached).length,
        closed30d: measured,
        ackCompliancePct: pct(ackMet),
        resolveCompliancePct: pct(resolveMet),
      },
      items,
    };
  }

  /** Memeriksa setiap menit apakah ada alert yang perlu dieskalasi. */
  @Interval('escalation', 60_000)
  async tick(now = new Date()) {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.run(now);
    } catch (e) {
      this.logger.error(`Pemeriksaan eskalasi gagal: ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async run(now: Date): Promise<number> {
    const policies = new Map((await this.policies()).map((p) => [p.severity, p]));
    const open = await this.prisma.alert.findMany({
      where: { status: { not: AlertStatus.CLOSED }, conditionActive: true },
      select: {
        id: true,
        number: true,
        severity: true,
        status: true,
        conditionActive: true,
        detectedAt: true,
        acknowledgedAt: true,
        closedAt: true,
        escalationLevel: true,
      },
    });

    let sent = 0;
    for (const a of open) {
      const step = nextEscalation(a, policies.get(a.severity), now);
      if (!step) continue;
      const ageMinutes = Math.floor((now.getTime() - a.detectedAt.getTime()) / 60_000);
      const note = `Tingkat ${step.level} → ${step.targetLabel}. Alert belum ditutup setelah ${ageMinutes} menit.`;
      // Update bersyarat: bila proses lain sudah menaikkan tingkat, baris ini tidak berubah dan pesan tidak dikirim.
      const updated = await this.prisma.$transaction(async (tx) => {
        const res = await tx.alert.updateMany({
          where: { id: a.id, escalationLevel: { lt: step.level }, status: { not: AlertStatus.CLOSED } },
          data: { escalationLevel: step.level, lastEscalatedAt: now },
        });
        if (res.count === 0) return false;
        await tx.alertEvent.create({
          data: { alertId: a.id, action: AlertAction.ESCALATED, toStatus: a.status, note, actorUsername: 'system' },
        });
        return true;
      });
      if (!updated) continue;
      sent++;
      this.notifications.notifyAlert(a.id, AlertAction.ESCALATED, {
        note,
        status: STATUS_LABEL[a.status],
        mention: step.mention,
        chatId: step.telegramChatId,
      });
    }
    if (sent) this.logger.log(`${sent} alert dieskalasi.`);
    return sent;
  }
}
