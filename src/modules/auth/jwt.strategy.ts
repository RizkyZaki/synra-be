import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { effectivePermissions } from '../../common/permissions';
import { MSG } from '../../common/constants/messages';

interface JwtPayload {
  sub: string;
  username: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Role dan hak aksesnya dibaca ulang dari DB setiap request, jadi perubahan role, hak akses role,
   * atau status nonaktif langsung berlaku tanpa menunggu token habis.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, isActive: true, role: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException(MSG.AUTH_REQUIRED);
    return {
      id: user.id,
      username: user.username,
      roleId: user.role.id,
      roleCode: user.role.code,
      roleName: user.role.name,
      permissions: effectivePermissions(user.role.code, user.role.permissions),
    };
  }
}
