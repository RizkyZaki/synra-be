import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Alert, AlertStatus, AuditAction, Prisma, Severity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';
import { paginate } from '../../common/dto/pagination.dto';
import { SEVERITY_RANK } from '../assets/asset-status';
import { alertCode } from '../notifications/alert-message';
import { ALERT_STATUSES, ListAlertsQueryDto } from './dto/alert.dto';
import { TRANSITIONS, TransitionName } from './alert-workflow';

const alertInclude = {
  asset: { select: { id: true, hostname: true, ipAddress: true, component: true, host: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.AlertInclude;

type AlertWithAsset = Prisma.AlertGetPayload<{ include: typeof alertInclude }>;

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(q: ListAlertsQueryDto) {
    const where = this.buildWhere(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({ where, include: alertInclude }),
      this.prisma.alert.count({ where }),
    ]);
    // Urut: belum ditutup dulu, yang kondisinya masih aktif sebelum yang sudah pulih,
    // lalu severity tertinggi, lalu terbaru.
    rows.sort(
      (a, b) =>
        Number(a.status === AlertStatus.CLOSED) - Number(b.status === AlertStatus.CLOSED) ||
        Number(!a.conditionActive) - Number(!b.conditionActive) ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
        b.detectedAt.getTime() - a.detectedAt.getTime(),
    );
    return paginate(rows.slice(q.skip, q.skip + q.limit).map(toView), total, q);
  }

  /** Alert terbuka teratas (dipakai dashboard). */
  async top(where: Prisma.AlertWhereInput, limit: number) {
    const rows = await this.prisma.alert.findMany({
      where: { ...where, status: { not: AlertStatus.CLOSED } },
      include: alertInclude,
    });
    rows.sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.detectedAt.getTime() - a.detectedAt.getTime(),
    );
    return rows.slice(0, limit).map(toView);
  }

  async get(id: string) {
    const alert = await this.prisma.alert.findUnique({
      where: { id },
      include: {
        ...alertInclude,
        events: { orderBy: { createdAt: 'asc' } },
        notifications: { orderBy: { createdAt: 'desc' }, select: { id: true, event: true, status: true, error: true, createdAt: true } },
        attachments: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true, uploadedByName: true, createdAt: true },
        },
      },
    });
    if (!alert) throw new NotFoundException(MSG.ALERT_NOT_FOUND);
    return { ...toView(alert), events: alert.events, notifications: alert.notifications, attachments: alert.attachments };
  }

  async transition(
    id: string,
    name: TransitionName,
    input: { note?: string; evidence?: string },
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    const rule = TRANSITIONS[name];
    const note = input.note?.trim() || null;
    const evidence = input.evidence?.trim() || null;
    if (rule.noteRequired && !note) throw new BadRequestException(MSG.ALERT_NOTE_REQUIRED);
    if (rule.evidenceRequired) {
      const attachmentCount = await this.prisma.alertAttachment.count({ where: { alertId: id } });
      if (!evidence && attachmentCount === 0) {
        throw new BadRequestException(MSG.ALERT_EVIDENCE_REQUIRED);
      }
      if (!evidence) {
        throw new BadRequestException(MSG.ALERT_EVIDENCE_TEXT_REQUIRED);
      }
      if (attachmentCount === 0) {
        throw new BadRequestException(MSG.ALERT_EVIDENCE_FILE_REQUIRED);
      }
    }

    const current = await this.prisma.alert.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(MSG.ALERT_NOT_FOUND);
    if (!rule.from.includes(current.status)) {
      throw new BadRequestException(MSG.ALERT_INVALID_TRANSITION(current.status, rule.to));
    }

    const now = new Date();
    const data: Prisma.AlertUpdateManyMutationInput = { status: rule.to };
    if (rule.to === AlertStatus.ACKNOWLEDGED) Object.assign(data, { acknowledgedAt: now, acknowledgedById: actor.id });
    if (rule.to === AlertStatus.CLOSED) {
      // dedupKey dikosongkan agar temuan berikutnya untuk aset+metrik yang sama boleh membuat alert baru.
      Object.assign(data, { closedAt: now, closedById: actor.id, closeNote: note, dedupKey: null });
    }

    await this.prisma.$transaction(async (tx) => {
      // Guard status lama: mencegah dua pengguna mengubah alert yang sama bersamaan.
      const { count } = await tx.alert.updateMany({ where: { id, status: current.status }, data });
      if (count === 0) throw new ConflictException(MSG.ALERT_STATUS_CHANGED);
      await tx.alertEvent.create({
        data: {
          alertId: id,
          action: rule.action,
          fromStatus: current.status,
          toStatus: rule.to,
          note,
          evidence,
          actorId: actor.id,
          actorUsername: actor.username,
        },
      });
      await this.audit.log(
        {
          action: AuditAction.ALERT_STATUS_CHANGE,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'Alert',
          entityId: id,
          before: { code: alertCode(current.number), status: current.status },
          after: { code: alertCode(current.number), status: rule.to, note, evidence },
          meta,
        },
        tx,
      );
    });

    this.notifications.notifyAlert(id, rule.action, { actor: actor.username, note });
    return this.get(id);
  }

  buildWhere(q: ListAlertsQueryDto): Prisma.AlertWhereInput {
    const statuses = (q.status ?? []).flatMap((s) =>
      s.toLowerCase() === 'open' ? ALERT_STATUSES.filter((x) => x !== AlertStatus.CLOSED) : [s.toUpperCase()],
    );
    const invalid = statuses.filter((s) => !ALERT_STATUSES.includes(s as AlertStatus));
    if (invalid.length > 0) {
      throw new BadRequestException(`Status tidak valid: ${invalid.join(', ')}. Gunakan ${ALERT_STATUSES.join(', ')} atau "open".`);
    }
    const numberMatch = q.search?.match(/^ALT-?(\d+)$/i);
    return {
      ...(statuses.length ? { status: { in: statuses as AlertStatus[] } } : {}),
      ...(q.severity?.length ? { severity: { in: q.severity } } : {}),
      metric: q.metric,
      assetId: q.assetId,
      asset: {
        ...(q.hostId ? { hostId: q.hostId } : {}),
        ...(q.component ? { component: q.component } : {}),
      },
      ...(q.from || q.to
        ? { detectedAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
      ...(numberMatch
        ? { number: Number(numberMatch[1]) }
        : q.search
          ? {
              OR: [
                { problem: { contains: q.search, mode: 'insensitive' } },
                { asset: { hostname: { contains: q.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
    };
  }
}

export function toView(a: AlertWithAsset & Partial<Alert>) {
  return {
    id: a.id,
    code: alertCode(a.number),
    number: a.number,
    asset: a.asset,
    metric: a.metric,
    label: a.label,
    severity: a.severity as Severity,
    status: a.status,
    problem: a.problem,
    value: a.value,
    lastValue: a.lastValue,
    thresholdValue: a.thresholdValue,
    picName: a.picName,
    recommendation: a.recommendation,
    detectedAt: a.detectedAt,
    lastEvaluatedAt: a.lastEvaluatedAt,
    conditionActive: a.conditionActive,
    recoveredAt: a.recoveredAt,
    acknowledgedAt: a.acknowledgedAt,
    closedAt: a.closedAt,
    closeNote: a.closeNote,
    escalationLevel: a.escalationLevel ?? 0,
    lastEscalatedAt: a.lastEscalatedAt ?? null,
  };
}
