import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Membatasi endpoint ke role tertentu. Tanpa decorator ini, semua user login boleh akses. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
