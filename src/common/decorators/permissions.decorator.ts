import { SetMetadata } from '@nestjs/common';
import { Permission } from '../permissions';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Membatasi endpoint ke user yang role-nya memiliki SALAH SATU hak akses yang disebut.
 * Tanpa decorator ini, semua user login boleh akses. Decorator di method menggantikan yang di class.
 */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);
