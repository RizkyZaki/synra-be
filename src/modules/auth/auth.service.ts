import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthUserDto, LoginResponseDto } from './dto/auth-response.dto';
import { isLocked, LockoutPolicy, registerFailure } from './lockout';

@Injectable()
export class AuthService {
  private readonly policy: LockoutPolicy;
  private readonly expiresIn: string;
  private readonly bcryptRounds: number;
  /** Hash dummy agar waktu respons sama untuk username yang tidak ada (mencegah enumerasi user). */
  private readonly dummyHash: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.policy = {
      maxAttempts: config.get<number>('LOGIN_MAX_ATTEMPTS', 5),
      lockoutMinutes: config.get<number>('LOGIN_LOCKOUT_MINUTES', 15),
    };
    this.expiresIn = config.get<string>('JWT_EXPIRES_IN', '8h');
    this.bcryptRounds = config.get<number>('BCRYPT_ROUNDS', 12);
    this.dummyHash = bcrypt.hashSync('synra-dummy-password', this.bcryptRounds);
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<LoginResponseDto> {
    const username = dto.username.trim().toLowerCase();
    const now = new Date();
    const user = await this.prisma.user.findUnique({ where: { username } });

    if (!user) {
      await bcrypt.compare(dto.password, this.dummyHash);
      await this.logFailure(username, null, 'USER_NOT_FOUND', meta);
      throw new UnauthorizedException(MSG.INVALID_CREDENTIALS);
    }

    if (isLocked(user, now)) {
      await this.logFailure(username, user.id, 'ACCOUNT_LOCKED', meta);
      throw new UnauthorizedException(MSG.ACCOUNT_LOCKED(formatJakarta(user.lockedUntil!)));
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);

    if (!passwordOk) {
      const next = registerFailure(user, this.policy, now);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: next.failedLoginCount, lockedUntil: next.lockedUntil },
      });
      await this.logFailure(username, user.id, 'WRONG_PASSWORD', meta);
      if (next.justLocked) {
        await this.audit.log({
          action: AuditAction.ACCOUNT_LOCKED,
          actorId: user.id,
          actorUsername: username,
          entity: 'User',
          entityId: user.id,
          after: { lockedUntil: next.lockedUntil!.toISOString() },
          meta,
        });
        throw new UnauthorizedException(MSG.ACCOUNT_JUST_LOCKED(this.policy.lockoutMinutes));
      }
      throw new UnauthorizedException(MSG.REMAINING_ATTEMPTS(next.remaining));
    }

    // Akun nonaktif dicek setelah password benar agar status akun tidak bocor ke penebak password.
    if (!user.isActive) {
      await this.logFailure(username, user.id, 'ACCOUNT_INACTIVE', meta);
      throw new UnauthorizedException(MSG.ACCOUNT_INACTIVE);
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    });
    await this.audit.log({
      action: AuditAction.LOGIN_SUCCESS,
      actorId: user.id,
      actorUsername: username,
      entity: 'User',
      entityId: user.id,
      meta,
    });

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    return { accessToken, tokenType: 'Bearer', expiresIn: this.expiresIn, user: toAuthUser(user) };
  }

  async me(userId: string): Promise<AuthUserDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return toAuthUser(user);
  }

  async changePassword(userId: string, dto: ChangePasswordDto, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(dto.oldPassword, user.passwordHash))) {
      throw new BadRequestException(MSG.WRONG_OLD_PASSWORD);
    }
    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException(MSG.SAME_PASSWORD);
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, this.bcryptRounds);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.audit.log({
      action: AuditAction.PASSWORD_CHANGE,
      actorId: user.id,
      actorUsername: user.username,
      entity: 'User',
      entityId: user.id,
      meta,
    });
  }

  private logFailure(username: string, userId: string | null, reason: string, meta: RequestMeta) {
    return this.audit.log({
      action: AuditAction.LOGIN_FAILED,
      actorId: userId,
      actorUsername: username.slice(0, 50),
      entity: 'User',
      entityId: userId ?? undefined,
      after: { reason },
      meta,
    });
  }
}

function toAuthUser(user: User): AuthUserDto {
  return { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
}

function formatJakarta(date: Date): string {
  return (
    date.toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'medium',
      timeStyle: 'short',
    }) + ' WIB'
  );
}
