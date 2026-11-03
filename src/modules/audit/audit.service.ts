import { Injectable, Logger } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  actorUsername: string;
  entity?: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  meta?: RequestMeta;
}

/**
 * Penulis audit log (append-only). Service ini sengaja tidak menyediakan update/delete;
 * database juga memblokir UPDATE/DELETE pada tabel AuditLog lewat trigger.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Mencatat audit. Bisa dipanggil di dalam transaksi dengan memberikan `tx`. */
  async log(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        actorUsername: entry.actorUsername,
        entity: entry.entity,
        entityId: entry.entityId,
        before: entry.before,
        after: entry.after,
        ipAddress: entry.meta?.ipAddress,
        userAgent: entry.meta?.userAgent?.slice(0, 500),
      },
    });
    this.logger.debug(`${entry.action} oleh ${entry.actorUsername}`);
  }
}
