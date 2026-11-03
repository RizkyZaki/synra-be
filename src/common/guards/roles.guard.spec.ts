import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function ctx(user?: { role: Role }): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  afterEach(() => jest.restoreAllMocks());

  it('mengizinkan semua user login bila endpoint tidak memakai @Roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(ctx({ role: Role.MANAGEMENT }))).toBe(true);
  });

  it('mengizinkan role yang terdaftar', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN, Role.OPERATOR]);
    expect(guard.canActivate(ctx({ role: Role.OPERATOR }))).toBe(true);
  });

  it.each([Role.MANAGEMENT, Role.AUDITOR])('menolak %s pada endpoint khusus ADMIN', (role) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    expect(() => guard.canActivate(ctx({ role }))).toThrow(ForbiddenException);
  });

  it('menolak bila tidak ada user di request', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Role.ADMIN]);
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});
