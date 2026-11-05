import { BadRequestException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AssetsService } from './assets.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const actor = (role: Role): AuthUser => ({ id: 'actor', username: 'actor', role });

function resolve(id: string | undefined, by: AuthUser, user: object | null = null): Promise<string | null> {
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } };
  const service = new AssetsService(prisma as never, {} as never, {} as never);
  return service['resolveSupervisor'](id, by);
}

describe('resolveSupervisor', () => {
  it('memakai supervisor yang login bila tidak ada pilihan', async () => {
    await expect(resolve(undefined, actor(Role.SUPERVISOR))).resolves.toBe('actor');
  });

  it('mengosongkan supervisor bila yang mengisi bukan supervisor', async () => {
    await expect(resolve(undefined, actor(Role.ADMIN))).resolves.toBeNull();
  });

  it('menerima user aktif ber-role SUPERVISOR', async () => {
    const user = { role: Role.SUPERVISOR, isActive: true };
    await expect(resolve('sup', actor(Role.ADMIN), user)).resolves.toBe('sup');
  });

  it.each([
    ['tidak ada', null],
    ['nonaktif', { role: Role.SUPERVISOR, isActive: false }],
    ['bukan supervisor', { role: Role.OPERATOR, isActive: true }],
  ])('menolak user yang %s', async (_label, user) => {
    await expect(resolve('x', actor(Role.ADMIN), user)).rejects.toBeInstanceOf(BadRequestException);
  });
});
