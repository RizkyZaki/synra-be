import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Host } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';
import { CreateHostDto, UpdateHostDto } from './dto/host.dto';

@Injectable()
export class HostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.host.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { assets: true } } },
    });
    return rows.map(({ _count, ...host }) => ({ ...host, assetCount: _count.assets }));
  }

  async get(id: string): Promise<Host> {
    const host = await this.prisma.host.findUnique({ where: { id } });
    if (!host) throw new NotFoundException(MSG.HOST_NOT_FOUND);
    return host;
  }

  async create(dto: CreateHostDto, actor: AuthUser, meta: RequestMeta): Promise<Host> {
    await this.ensureCodeFree(dto.code);
    return this.prisma.$transaction(async (tx) => {
      const host = await tx.host.create({ data: dto });
      await this.audit.log(
        { action: AuditAction.HOST_CREATE, actorId: actor.id, actorUsername: actor.username, entity: 'Host', entityId: host.id, after: snapshot(host), meta },
        tx,
      );
      return host;
    });
  }

  async update(id: string, dto: UpdateHostDto, actor: AuthUser, meta: RequestMeta): Promise<Host> {
    const before = await this.get(id);
    if (dto.code && dto.code !== before.code) await this.ensureCodeFree(dto.code);
    return this.prisma.$transaction(async (tx) => {
      const host = await tx.host.update({ where: { id }, data: dto });
      await this.audit.log(
        { action: AuditAction.HOST_UPDATE, actorId: actor.id, actorUsername: actor.username, entity: 'Host', entityId: id, before: snapshot(before), after: snapshot(host), meta },
        tx,
      );
      return host;
    });
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta): Promise<void> {
    const before = await this.get(id);
    if ((await this.prisma.asset.count({ where: { hostId: id } })) > 0) {
      throw new ConflictException(MSG.HOST_HAS_ASSETS);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.host.delete({ where: { id } });
      await this.audit.log(
        { action: AuditAction.HOST_DELETE, actorId: actor.id, actorUsername: actor.username, entity: 'Host', entityId: id, before: snapshot(before), meta },
        tx,
      );
    });
  }

  private async ensureCodeFree(code: string) {
    if (await this.prisma.host.findUnique({ where: { code } })) {
      throw new ConflictException(MSG.HOST_CODE_TAKEN);
    }
  }
}

function snapshot(b: Host) {
  return { code: b.code, name: b.name, region: b.region };
}
