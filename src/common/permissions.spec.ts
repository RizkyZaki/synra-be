import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ALL_PERMISSIONS,
  canSupervise,
  effectivePermissions,
  hasPermission,
  isWithinReach,
  SYSTEM_ROLES,
} from './permissions';
import { codeFromName } from '../modules/roles/roles.service';

describe('katalog hak akses', () => {
  it('tidak punya kunci ganda', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it('hak role sistem di migrasi sama dengan SYSTEM_ROLES', () => {
    const sql = readFileSync(
      join(__dirname, '../../prisma/migrations/20261116090000_dynamic_roles/migration.sql'),
      'utf8',
    );
    for (const role of SYSTEM_ROLES) {
      const match = sql.match(new RegExp(`'${role.code}', '[^']+',\\s*'[^']*',\\s*ARRAY\\[([^\\]]*)\\]`));
      expect(match).not.toBeNull();
      const inSql = match![1].split(',').map((s) => s.trim().replace(/'/g, ''));
      expect(inSql.sort()).toEqual([...role.permissions].sort());
    }
  });
});

describe('hasPermission / effectivePermissions', () => {
  it('ADMIN selalu punya semua hak', () => {
    expect(effectivePermissions('ADMIN', [])).toEqual(ALL_PERMISSIONS);
    expect(hasPermission({ roleCode: 'ADMIN', permissions: [] }, 'roles.manage')).toBe(true);
  });

  it('kunci usang di DB diabaikan', () => {
    expect(effectivePermissions('X', ['alerts.view', 'fitur.lama'])).toEqual(['alerts.view']);
  });

  it('role lain hanya punya yang dicentang', () => {
    const user = { roleCode: 'SPV', permissions: ['alerts.view'] };
    expect(hasPermission(user, 'alerts.view')).toBe(true);
    expect(hasPermission(user, 'alerts.review')).toBe(false);
    expect(hasPermission(undefined, 'alerts.view')).toBe(false);
  });
});

describe('isWithinReach (anti eskalasi)', () => {
  const spv = { roleCode: 'SPV', permissions: ['users.manage', 'alerts.view', 'alerts.handle'] };

  it('ADMIN boleh memberikan role apa pun', () => {
    expect(isWithinReach({ roleCode: 'ADMIN', permissions: [] }, 'ADMIN', [])).toBe(true);
  });

  it('non-ADMIN tidak pernah boleh memberikan role ADMIN', () => {
    expect(isWithinReach(spv, 'ADMIN', [])).toBe(false);
  });

  it('non-ADMIN hanya boleh memberikan hak yang ia miliki', () => {
    expect(isWithinReach(spv, 'OPR', ['alerts.view', 'alerts.handle'])).toBe(true);
    expect(isWithinReach(spv, 'OPR', ['alerts.view', 'roles.manage'])).toBe(false);
  });
});

describe('canSupervise', () => {
  it('hanya role non-ADMIN dengan assets.supervise', () => {
    expect(canSupervise('SPV', ['assets.supervise'])).toBe(true);
    expect(canSupervise('ADMIN', ['assets.supervise'])).toBe(false);
    expect(canSupervise('OPR', ['assets.view'])).toBe(false);
  });
});

describe('codeFromName', () => {
  it.each([
    ['Supervisor Jawa Timur', 'SUPERVISOR_JAWA_TIMUR'],
    ['  tim-dba (pusat) ', 'TIM_DBA_PUSAT'],
    ['Tim Keamanan & Jaringan', 'TIM_KEAMANAN_JARINGAN'],
    ['123 NOC', 'NOC'],
    ['!!', 'ROLE'],
  ])('%s → %s', (name, code) => {
    expect(codeFromName(name)).toBe(code);
  });

  it('dipotong maksimal 30 karakter tanpa garis bawah di ujung', () => {
    const code = codeFromName('Supervisor Infrastruktur Wilayah Jawa Bagian Timur');
    expect(code.length).toBeLessThanOrEqual(30);
    expect(code.endsWith('_')).toBe(false);
  });
});
