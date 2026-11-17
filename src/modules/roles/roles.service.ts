import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccessRole, AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';
import {
  ADMIN_ROLE_CODE,
  effectivePermissions,
  isPermission,
  isWithinReach,
  PERMISSION_GROUPS,
  SYSTEM_ROLES,
} from '../../common/permissions';
import { CreateRoleDto, RoleResponseDto, UpdateRoleDto } from './dto/role.dto';

type RoleWithCount = AccessRole & { _count: { users: number } };

const SYSTEM_ORDER = new Map(SYSTEM_ROLES.map((r, i) => [r.code, i]));

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Katalog hak akses per kelompok, untuk form centang di FE. */
  catalog() {
    return PERMISSION_GROUPS;
  }

  /** Role sistem lebih dulu (urutan bawaan), lalu role buatan admin urut nama. */
  async list(): Promise<RoleResponseDto[]> {
    const rows = await this.prisma.accessRole.findMany({ include: { _count: { select: { users: true } } } });
    return rows
      .sort((a, b) => {
        const ia = SYSTEM_ORDER.get(a.code) ?? Number.MAX_SAFE_INTEGER;
        const ib = SYSTEM_ORDER.get(b.code) ?? Number.MAX_SAFE_INTEGER;
        return ia !== ib ? ia - ib : a.name.localeCompare(b.name, 'id');
      })
      .map(toResponse);
  }

  async get(id: string): Promise<RoleResponseDto> {
    return toResponse(await this.findOrFail(id));
  }

  async create(dto: CreateRoleDto, actor: AuthUser, meta: RequestMeta): Promise<RoleResponseDto> {
    const permissions = this.validatePermissions(dto.permissions);
    this.assertGrantable(actor, permissions);
    await this.assertNameFree(dto.name);

    const code = dto.code ?? (await this.freeCodeFrom(dto.name));
    if (code === ADMIN_ROLE_CODE || (await this.prisma.accessRole.findUnique({ where: { code } }))) {
      throw new ConflictException(MSG.ROLE_CODE_TAKEN);
    }

    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.accessRole.create({
        data: { code, name: dto.name, description: dto.description || null, permissions },
        include: { _count: { select: { users: true } } },
      });
      await this.audit.log(
        {
          action: AuditAction.ROLE_CREATE,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'AccessRole',
          entityId: created.id,
          after: snapshot(created),
          meta,
        },
        tx,
      );
      return created;
    });
    return toResponse(role);
  }

  async update(id: string, dto: UpdateRoleDto, actor: AuthUser, meta: RequestMeta): Promise<RoleResponseDto> {
    const before = await this.findOrFail(id);
    if (!isWithinReach(actor, before.code, before.permissions)) {
      throw new ForbiddenException(MSG.ROLE_OUT_OF_REACH);
    }

    let permissions: string[] | undefined;
    if (dto.permissions !== undefined) {
      if (before.code === ADMIN_ROLE_CODE) throw new BadRequestException(MSG.ROLE_ADMIN_LOCKED);
      permissions = this.validatePermissions(dto.permissions);
      // Hanya hak yang baru ditambahkan yang dicek; hak lama boleh tetap atau dicabut.
      this.assertGrantable(
        actor,
        permissions.filter((p) => !before.permissions.includes(p)),
      );
    }
    if (dto.name !== undefined && dto.name !== before.name) await this.assertNameFree(dto.name, id);

    const role = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.accessRole.update({
        where: { id },
        data: {
          name: dto.name,
          description: dto.description === undefined ? undefined : dto.description || null,
          permissions,
        },
        include: { _count: { select: { users: true } } },
      });
      await this.audit.log(
        {
          action: AuditAction.ROLE_UPDATE,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'AccessRole',
          entityId: id,
          before: snapshot(before),
          after: snapshot(updated),
          meta,
        },
        tx,
      );
      return updated;
    });
    return toResponse(role);
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta): Promise<void> {
    const role = await this.findOrFail(id);
    if (role.isSystem) throw new BadRequestException(MSG.ROLE_SYSTEM_DELETE);
    if (!isWithinReach(actor, role.code, role.permissions)) {
      throw new ForbiddenException(MSG.ROLE_OUT_OF_REACH);
    }
    if (role._count.users > 0) throw new BadRequestException(MSG.ROLE_IN_USE(role._count.users));

    await this.prisma.$transaction(async (tx) => {
      await tx.accessRole.delete({ where: { id } });
      await this.audit.log(
        {
          action: AuditAction.ROLE_DELETE,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'AccessRole',
          entityId: id,
          before: snapshot(role),
          meta,
        },
        tx,
      );
    });
  }

  private validatePermissions(keys: string[]): string[] {
    const unknown = keys.filter((k) => !isPermission(k));
    if (unknown.length) throw new BadRequestException(MSG.PERMISSION_UNKNOWN(unknown.join(', ')));
    return keys;
  }

  private assertGrantable(actor: AuthUser, permissions: string[]) {
    if (!isWithinReach(actor, '', permissions)) throw new ForbiddenException(MSG.ROLE_OUT_OF_REACH);
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const same = await this.prisma.accessRole.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, id: exceptId ? { not: exceptId } : undefined },
    });
    if (same) throw new ConflictException(MSG.ROLE_NAME_TAKEN);
  }

  /** Kode dari nama ("Supervisor Jawa Timur" → SUPERVISOR_JAWA_TIMUR), diberi akhiran _2, _3… bila sudah dipakai. */
  private async freeCodeFrom(name: string): Promise<string> {
    const base = codeFromName(name);
    const taken = new Set(
      (await this.prisma.accessRole.findMany({ where: { code: { startsWith: base } }, select: { code: true } })).map(
        (r) => r.code,
      ),
    );
    taken.add(ADMIN_ROLE_CODE);
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      const candidate = `${base.slice(0, 30 - String(n).length - 1)}_${n}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private async findOrFail(id: string): Promise<RoleWithCount> {
    const role = await this.prisma.accessRole.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException(MSG.ROLE_NOT_FOUND);
    return role;
  }
}

export function codeFromName(name: string): string {
  const code = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^[^A-Z]+/, '')
    .slice(0, 30)
    .replace(/_$/, '');
  return code.length >= 2 ? code : 'ROLE';
}

function snapshot(r: AccessRole): Prisma.InputJsonValue {
  return { code: r.code, name: r.name, description: r.description, permissions: r.permissions };
}

function toResponse(r: RoleWithCount): RoleResponseDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    permissions: effectivePermissions(r.code, r.permissions),
    isSystem: r.isSystem,
    locked: r.code === ADMIN_ROLE_CODE,
    userCount: r._count.users,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
