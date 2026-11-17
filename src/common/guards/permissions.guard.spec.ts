import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AuthUser } from '../decorators/current-user.decorator';

const user = (roleCode: string, permissions: string[] = []): AuthUser => ({
  id: 'u1',
  username: 'u1',
  roleId: 'r1',
  roleCode,
  roleName: roleCode,
  permissions,
});

function ctx(u?: AuthUser): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: u }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const reflector = new Reflector();
  const guard = new PermissionsGuard(reflector);

  afterEach(() => jest.restoreAllMocks());

  it('mengizinkan semua user login bila endpoint tidak memakai @RequirePermission', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(ctx(user('MANAGEMENT')))).toBe(true);
  });

  it('mengizinkan role yang memiliki salah satu hak akses', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['users.manage', 'assets.manage']);
    expect(guard.canActivate(ctx(user('SPV_JATIM', ['assets.manage'])))).toBe(true);
  });

  it('ADMIN selalu diizinkan walau daftar hak aksesnya kosong', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['roles.manage']);
    expect(guard.canActivate(ctx(user('ADMIN')))).toBe(true);
  });

  it('menolak role tanpa hak akses yang diminta', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['users.manage']);
    expect(() => guard.canActivate(ctx(user('AUDITOR', ['audit.view'])))).toThrow(ForbiddenException);
  });

  it('menolak bila tidak ada user di request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['audit.view']);
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});
