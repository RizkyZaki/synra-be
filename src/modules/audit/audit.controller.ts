import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuditAction, Prisma, Role } from '@prisma/client';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { paginate, PaginationQueryDto } from '../../common/dto/pagination.dto';

const csvList = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value;

class ListAuditQueryDto extends PaginationQueryDto {
  @IsOptional()
  @Transform(csvList)
  @IsEnum(AuditAction, { each: true, message: 'action tidak valid.' })
  action?: AuditAction[];

  /** Username pelaku */
  @IsOptional()
  @IsString({ message: 'actor harus berupa teks.' })
  @MaxLength(50, { message: 'actor maksimal 50 karakter.' })
  actor?: string;

  /** Mis. Alert, ThresholdRule, User, Report */
  @IsOptional()
  @IsString({ message: 'entity harus berupa teks.' })
  entity?: string;

  @IsOptional()
  @IsString({ message: 'entityId harus berupa teks.' })
  entityId?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'from harus berupa tanggal ISO 8601.' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to harus berupa tanggal ISO 8601.' })
  to?: string;
}

const EXPORT_LIMIT = 50_000;

/** Audit log hanya bisa dibaca. Tidak ada endpoint ubah atau hapus. */
@ApiTags('Audit')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.AUDITOR)
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query() q: ListAuditQueryDto) {
    const where = buildWhere(q);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: { id: 'desc' }, skip: q.skip, take: q.limit }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  /** Ekspor audit log (CSV) dengan filter yang sama. Ekspor ini juga dicatat di audit log. */
  @Get('export')
  @ApiProduces('text/csv')
  async export(
    @Query() q: ListAuditQueryDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res() res: Response,
  ) {
    const rows = await this.prisma.auditLog.findMany({ where: buildWhere(q), orderBy: { id: 'desc' }, take: EXPORT_LIMIT });
    const header = ['id', 'waktu', 'aksi', 'pelaku', 'entitas', 'entityId', 'sebelum', 'sesudah', 'ip'];
    const lines = rows.map((r) =>
      [r.id, r.createdAt.toISOString(), r.action, r.actorUsername, r.entity, r.entityId, json(r.before), json(r.after), r.ipAddress]
        .map(csvCell)
        .join(','),
    );
    await this.audit.log({
      action: AuditAction.REPORT_EXPORT,
      actorId: actor.id,
      actorUsername: actor.username,
      entity: 'AuditLog',
      after: { type: 'AUDIT_LOG', format: 'csv', rows: rows.length, filter: { ...q } as Prisma.InputJsonValue },
      meta,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="synra-audit-${stamp}.csv"`,
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    res.end('﻿' + [header.join(','), ...lines].join('\r\n'));
  }
}

function buildWhere(q: ListAuditQueryDto): Prisma.AuditLogWhereInput {
  return {
    ...(q.action?.length ? { action: { in: q.action } } : {}),
    ...(q.actor ? { actorUsername: { contains: q.actor.toLowerCase(), mode: 'insensitive' } } : {}),
    entity: q.entity,
    entityId: q.entityId,
    ...(q.from || q.to
      ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
      : {}),
  };
}

function json(v: Prisma.JsonValue | null): string {
  return v === null ? '' : JSON.stringify(v);
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Cegah formula injection di Excel.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
