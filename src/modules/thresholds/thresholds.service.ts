import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { AuditAction, Prisma, RuleMetric, ThresholdOperator, ThresholdRule } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';
import { SEVERITY_RANK } from '../assets/asset-status';
import { ReplaceThresholdsDto, UpdateThresholdRuleDto } from './dto/threshold.dto';
import { DEFAULT_RECOMMENDATION, DEFAULT_RULES, METRIC_UNIT, RuleLevel, validateLevels } from './threshold-rules';
import { RulesByMetric } from './threshold-evaluator';

@Injectable()
export class ThresholdsService implements OnModuleInit {
  private readonly logger = new Logger(ThresholdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Mengisi aturan default untuk metrik yang belum punya aturan sama sekali (instalasi baru,
   * atau metrik baru setelah upgrade). Admin tidak bisa mengosongkan aturan satu metrik,
   * jadi metrik yang sudah diatur tidak akan ditimpa.
   */
  async onModuleInit() {
    const existing = new Set((await this.prisma.thresholdRule.findMany({ select: { metric: true } })).map((r) => r.metric));
    const missing = DEFAULT_RULES.filter((r) => !existing.has(r.metric));
    if (missing.length === 0) return;
    await this.prisma.thresholdRule.createMany({
      data: missing.flatMap((r) =>
        r.levels.map((l) => ({ metric: r.metric, ...l, recommendation: DEFAULT_RECOMMENDATION[r.metric] })),
      ),
      skipDuplicates: true,
    });
    this.logger.log(`Aturan threshold default dibuat untuk: ${missing.map((r) => r.metric).join(', ')}.`);
  }

  async list() {
    const rules = await this.prisma.thresholdRule.findMany();
    return Object.values(RuleMetric).map((metric) => ({
      metric,
      unit: METRIC_UNIT[metric],
      levels: rules
        .filter((r) => r.metric === metric)
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
    }));
  }

  /** Aturan dalam bentuk yang dipakai evaluator. */
  async rulesByMetric(): Promise<RulesByMetric> {
    const rules = await this.prisma.thresholdRule.findMany();
    const result: RulesByMetric = {};
    for (const r of rules) (result[r.metric] ??= []).push(toLevel(r));
    return result;
  }

  /** Mengganti seluruh level satu metrik. Level yang tidak dikirim akan dihapus. */
  async replace(metric: RuleMetric, dto: ReplaceThresholdsDto, actor: AuthUser, meta: RequestMeta) {
    const levels: RuleLevel[] = dto.levels.map((l) => ({
      severity: l.severity,
      operator: l.operator ?? ThresholdOperator.GT,
      value: l.value,
      enabled: l.enabled ?? true,
      recommendation: l.recommendation ?? null,
    }));
    const error = validateLevels(metric, levels);
    if (error) throw new BadRequestException(error);

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.thresholdRule.findMany({ where: { metric } });
      await tx.thresholdRule.deleteMany({ where: { metric } });
      await tx.thresholdRule.createMany({
        data: levels.map((l) => ({
          metric,
          ...l,
          // undefined = pertahankan teks lama; string kosong = kembali ke teks default.
          recommendation:
            l.recommendation == null
              ? (before.find((b) => b.severity === l.severity)?.recommendation ?? DEFAULT_RECOMMENDATION[metric])
              : l.recommendation.trim() || DEFAULT_RECOMMENDATION[metric],
          updatedById: actor.id,
        })),
      });
      const after = await tx.thresholdRule.findMany({ where: { metric } });
      await this.logChange(tx, actor, meta, metric, before, after);
    });
    return (await this.list()).find((m) => m.metric === metric);
  }

  /** Mengubah satu level. Urutan level metrik tetap divalidasi. */
  async updateRule(id: string, dto: UpdateThresholdRuleDto, actor: AuthUser, meta: RequestMeta) {
    const rule = await this.prisma.thresholdRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException(MSG.THRESHOLD_NOT_FOUND);

    const siblings = await this.prisma.thresholdRule.findMany({ where: { metric: rule.metric } });
    const proposed = siblings.map((r) => (r.id === id ? { ...toLevel(r), ...stripUndefined(dto) } : toLevel(r)));
    const error = validateLevels(rule.metric, proposed);
    if (error) throw new BadRequestException(error);

    const data = { ...dto };
    if (data.recommendation !== undefined) data.recommendation = data.recommendation.trim() || DEFAULT_RECOMMENDATION[rule.metric];

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.thresholdRule.update({
        where: { id },
        data: { ...data, updatedById: actor.id },
      });
      await this.logChange(tx, actor, meta, rule.metric, [rule], [updated]);
      return updated;
    });
  }

  private logChange(
    tx: Prisma.TransactionClient,
    actor: AuthUser,
    meta: RequestMeta,
    metric: RuleMetric,
    before: ThresholdRule[],
    after: ThresholdRule[],
  ) {
    return this.audit.log(
      {
        action: AuditAction.THRESHOLD_UPDATE,
        actorId: actor.id,
        actorUsername: actor.username,
        entity: 'ThresholdRule',
        entityId: metric,
        before: before.map(auditView),
        after: after.map(auditView),
        meta,
      },
      tx,
    );
  }
}

function toLevel(r: ThresholdRule): RuleLevel {
  return { severity: r.severity, operator: r.operator, value: r.value, enabled: r.enabled, recommendation: r.recommendation };
}

function auditView(r: ThresholdRule) {
  return { severity: r.severity, operator: r.operator, value: r.value, enabled: r.enabled, recommendation: r.recommendation };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
