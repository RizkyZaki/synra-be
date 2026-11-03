import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Bpd } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';
import { CreateBpdDto, UpdateBpdDto } from './dto/bpd.dto';

@Injectable()
export class BpdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.bpd.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { assets: true } } },
    });
    return rows.map(({ _count, ...bpd }) => ({ ...bpd, assetCount: _count.assets }));
  }

  async get(id: string): Promise<Bpd> {
    const bpd = await this.prisma.bpd.findUnique({ where: { id } });
    if (!bpd) throw new NotFoundException(MSG.BPD_NOT_FOUND);
    return bpd;
  }

  async create(dto: CreateBpdDto, actor: AuthUser, meta: RequestMeta): Promise<Bpd> {
    await this.ensureCodeFree(dto.code);
    return this.prisma.$transaction(async (tx) => {
      const bpd = await tx.bpd.create({ data: dto });
      await this.audit.log(
        { action: AuditAction.BPD_CREATE, actorId: actor.id, actorUsername: actor.username, entity: 'Bpd', entityId: bpd.id, after: snapshot(bpd), meta },
        tx,
      );
      return bpd;
    });
  }

  async update(id: string, dto: UpdateBpdDto, actor: AuthUser, meta: RequestMeta): Promise<Bpd> {
    const before = await this.get(id);
    if (dto.code && dto.code !== before.code) await this.ensureCodeFree(dto.code);
    return this.prisma.$transaction(async (tx) => {
      const bpd = await tx.bpd.update({ where: { id }, data: dto });
      await this.audit.log(
        { action: AuditAction.BPD_UPDATE, actorId: actor.id, actorUsername: actor.username, entity: 'Bpd', entityId: id, before: snapshot(before), after: snapshot(bpd), meta },
        tx,
      );
      return bpd;
    });
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta): Promise<void> {
    const before = await this.get(id);
    if ((await this.prisma.asset.count({ where: { bpdId: id } })) > 0) {
      throw new ConflictException(MSG.BPD_HAS_ASSETS);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.bpd.delete({ where: { id } });
      await this.audit.log(
        { action: AuditAction.BPD_DELETE, actorId: actor.id, actorUsername: actor.username, entity: 'Bpd', entityId: id, before: snapshot(before), meta },
        tx,
      );
    });
  }

  private async ensureCodeFree(code: string) {
    if (await this.prisma.bpd.findUnique({ where: { code } })) {
      throw new ConflictException(MSG.BPD_CODE_TAKEN);
    }
  }
}

function snapshot(b: Bpd) {
  return { code: b.code, name: b.name, region: b.region };
}
