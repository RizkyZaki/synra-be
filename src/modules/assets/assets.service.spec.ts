import { BadRequestException } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const actor = (roleCode: string, permissions: string[] = []): AuthUser => ({
  id: 'actor',
  username: 'actor',
  roleId: 'r',
  roleCode,
  roleName: roleCode,
  permissions,
});
const supervisorRole = { code: 'SPV_JATIM', permissions: ['assets.view', 'assets.supervise'] };

function resolve(id: string | undefined, by: AuthUser, user: object | null = null): Promise<string | null> {
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  const service = new AssetsService(prisma as never, {} as never, {} as never);
  return service['resolveSupervisor'](id, by);
}

describe('resolveSupervisor', () => {
  it('memakai supervisor yang login bila tidak ada pilihan', async () => {
    await expect(resolve(undefined, actor('SPV_JATIM', ['assets.supervise']))).resolves.toBe('actor');
  });

  it('mengosongkan supervisor bila yang mengisi bukan supervisor', async () => {
    await expect(resolve(undefined, actor('OPERATOR', ['assets.view']))).resolves.toBeNull();
  });

  it('ADMIN tidak otomatis menjadi supervisor', async () => {
    await expect(resolve(undefined, actor('ADMIN', ['assets.supervise']))).resolves.toBeNull();
  });

  it('menerima user aktif yang role-nya punya hak supervisor aset', async () => {
    const user = { role: supervisorRole, isActive: true };
    await expect(resolve('sup', actor('ADMIN'), user)).resolves.toBe('sup');
  });

  it.each([
    ['tidak ada', null],
    ['nonaktif', { role: supervisorRole, isActive: false }],
    ['bukan supervisor', { role: { code: 'OPERATOR', permissions: ['assets.view'] }, isActive: true }],
    ['ADMIN', { role: { code: 'ADMIN', permissions: ['assets.supervise'] }, isActive: true }],
  ])('menolak user yang %s', async (_label, user) => {
    await expect(resolve('x', actor('ADMIN'), user)).rejects.toBeInstanceOf(BadRequestException);
  });
});
