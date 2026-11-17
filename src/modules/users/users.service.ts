import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessRole, AuditAction, Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';
import { paginate, Paginated } from '../../common/dto/pagination.dto';
import { ADMIN_ROLE_CODE, isWithinReach } from '../../common/permissions';
import {
  CreateUserDto,
  ListUsersQueryDto,
  ResetPasswordDto,
  UpdateUserDto,
  UserResponseDto,
} from './dto/user.dto';
import { isLocked } from '../auth/lockout';

type UserWithRole = User & { role: AccessRole };

@Injectable()
export class UsersService {
  private readonly bcryptRounds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.bcryptRounds = config.get<number>('BCRYPT_ROUNDS', 12);
  }

  /** User aktif yang role-nya memiliki hak "Supervisor aset" (ADMIN tidak termasuk). */
  supervisors() {
    return this.prisma.user.findMany({
      where: {
        isActive: true,
        role: { code: { not: ADMIN_ROLE_CODE }, permissions: { has: 'assets.supervise' } },
      },
      select: { id: true, username: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  }

  async list(q: ListUsersQueryDto): Promise<Paginated<UserResponseDto>> {
    const where: Prisma.UserWhereInput = {
      roleId: q.roleId,
      isActive: q.isActive,
      ...(q.search
        ? {
            OR: [
              { username: { contains: q.search, mode: 'insensitive' } },
              { fullName: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { role: true },
        orderBy: { username: 'asc' },
        skip: q.skip,
        take: q.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return paginate(rows.map(toResponse), total, q);
  }

  async get(id: string): Promise<UserResponseDto> {
    return toResponse(await this.findOrFail(id));
  }

  async create(dto: CreateUserDto, actor: AuthUser, meta: RequestMeta): Promise<UserResponseDto> {
    const role = await this.findRole(dto.roleId);
    this.assertReach(actor, role, MSG.ROLE_OUT_OF_REACH);

    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new ConflictException(MSG.USERNAME_TAKEN);

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { username: dto.username, passwordHash, fullName: dto.fullName, roleId: role.id },
        include: { role: true },
      });
      await this.audit.log(
        {
          action: AuditAction.USER_CREATE,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'User',
          entityId: created.id,
          after: snapshot(created),
          meta,
        },
        tx,
      );
      return created;
    });
    return toResponse(user);
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<UserResponseDto> {
    const before = await this.findOrFail(id);
    if (id !== actor.id) this.assertReach(actor, before.role, MSG.USER_OUT_OF_REACH);

    const changesRole = dto.roleId !== undefined && dto.roleId !== before.roleId;
    const deactivates = dto.isActive === false && before.isActive;
    if (id === actor.id && (changesRole || deactivates)) {
      throw new BadRequestException(MSG.CANNOT_MODIFY_SELF);
    }
    if (changesRole) this.assertReach(actor, await this.findRole(dto.roleId!), MSG.ROLE_OUT_OF_REACH);

    const user = await this.prisma.$transaction(async (tx) => {
      if (before.role.code === ADMIN_ROLE_CODE && before.isActive && (changesRole || deactivates)) {
        const otherAdmins = await tx.user.count({
          where: { role: { code: ADMIN_ROLE_CODE }, isActive: true, id: { not: id } },
        });
        if (otherAdmins === 0) throw new BadRequestException(MSG.LAST_ADMIN);
      }
      const updated = await tx.user.update({
        where: { id },
        data: { fullName: dto.fullName, roleId: dto.roleId, isActive: dto.isActive },
        include: { role: true },
      });
      await this.audit.log(
        {
          action: AuditAction.USER_UPDATE,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'User',
          entityId: id,
          before: snapshot(before),
          after: snapshot(updated),
          meta,
        },
        tx,
      );
      return updated;
    });
    return toResponse(user);
  }

  async unlock(id: string, actor: AuthUser, meta: RequestMeta): Promise<UserResponseDto> {
    const before = await this.findOrFail(id);
    this.assertReach(actor, before.role, MSG.USER_OUT_OF_REACH);
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { failedLoginCount: 0, lockedUntil: null },
        include: { role: true },
      });
      await this.audit.log(
        {
          action: AuditAction.USER_UNLOCK,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'User',
          entityId: id,
          before: { failedLoginCount: before.failedLoginCount, lockedUntil: before.lockedUntil?.toISOString() ?? null },
          after: { failedLoginCount: 0, lockedUntil: null },
          meta,
        },
        tx,
      );
      return updated;
    });
    return toResponse(user);
  }

  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
    actor: AuthUser,
    meta: RequestMeta,
  ): Promise<void> {
    const target = await this.findOrFail(id);
    // Mengambil alih akun ber-hak lebih tinggi lewat reset password = eskalasi hak akses.
    this.assertReach(actor, target.role, MSG.USER_OUT_OF_REACH);
    const passwordHash = await bcrypt.hash(dto.newPassword, this.bcryptRounds);
    await this.prisma.$transaction(async (tx) => {
      // Reset password juga membuka kunci akun.
      await tx.user.update({
        where: { id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      });
      await this.audit.log(
        {
          action: AuditAction.USER_RESET_PASSWORD,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'User',
          entityId: id,
          meta,
        },
        tx,
      );
    });
  }

  private assertReach(actor: AuthUser, role: AccessRole, message: string) {
    if (!isWithinReach(actor, role.code, role.permissions)) throw new ForbiddenException(message);
  }

  private async findRole(id: string): Promise<AccessRole> {
    const role = await this.prisma.accessRole.findUnique({ where: { id } });
    if (!role) throw new BadRequestException(MSG.ROLE_NOT_FOUND);
    return role;
  }

  private async findOrFail(id: string): Promise<UserWithRole> {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!user) throw new NotFoundException(MSG.USER_NOT_FOUND);
    return user;
  }
}

function snapshot(u: UserWithRole) {
  return { username: u.username, fullName: u.fullName, role: u.role.code, isActive: u.isActive };
}

function toResponse(u: UserWithRole): UserResponseDto {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: { id: u.role.id, code: u.role.code, name: u.role.name },
    isActive: u.isActive,
    isLocked: isLocked(u, new Date()),
    lockedUntil: u.lockedUntil,
    failedLoginCount: u.failedLoginCount,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}
