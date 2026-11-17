import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  username: string;
  roleId: string;
  /** Kode role, mis. ADMIN atau SPV_JATIM */
  roleCode: string;
  roleName: string;
  /** Hak akses efektif role (ADMIN = semua) */
  permissions: string[];
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);
