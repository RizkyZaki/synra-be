/**
 * Katalog hak akses (permission) SYNRA. Role dibuat dan diatur ADMIN lewat menu Administrasi;
 * setiap role menyimpan daftar kunci di bawah. Menambah fitur baru = menambah kunci di sini,
 * memakainya di `@RequirePermission`, lalu mencentangnya untuk role yang perlu.
 */
export const PERMISSION_GROUPS = [
  {
    group: 'Menu',
    items: [
      { key: 'alerts.view', label: 'Alert & Insiden', description: 'Membuka menu Alert & Insiden.' },
      { key: 'notifications.view', label: 'Notifikasi & Eskalasi', description: 'Membuka menu Notifikasi & Eskalasi beserta matriks eskalasi.' },
      { key: 'monitoring.view', label: 'Monitoring', description: 'Membuka menu Infrastruktur, Database, Storage, dan Availability.' },
      { key: 'backup.view', label: 'Backup & Keamanan', description: 'Membuka menu Backup & Keamanan beserta riwayat job backup.' },
      { key: 'assets.view', label: 'Inventaris Aset', description: 'Membuka menu Inventaris Aset.' },
      { key: 'lifecycle.view', label: 'Lifecycle', description: 'Membuka menu OS, lisensi, sertifikat, garansi, dan kontrak.' },
      { key: 'reports.view', label: 'Laporan', description: 'Membuka dan mengekspor laporan harian.' },
      { key: 'audit.view', label: 'Audit Trail', description: 'Membaca dan mengekspor audit log.' },
      { key: 'dashboard.executive', label: 'Ringkasan eksekutif', description: 'Menampilkan ringkasan eksekutif di Pusat Kendali.' },
    ],
  },
  {
    group: 'Alert',
    items: [
      { key: 'alerts.handle', label: 'Tangani alert', description: 'Acknowledge, mulai penanganan, ajukan review, dan unggah lampiran.' },
      { key: 'alerts.review', label: 'Review alert', description: 'Mengembalikan dan menutup alert.' },
      { key: 'alerts.evaluate', label: 'Evaluasi manual', description: 'Menjalankan evaluasi threshold secara manual.' },
    ],
  },
  {
    group: 'Notifikasi & Eskalasi',
    items: [
      { key: 'escalation.manage', label: 'Ubah matriks eskalasi', description: 'Mengubah batas SLA dan tingkat eskalasi per severity.' },
      { key: 'notifications.test', label: 'Kirim notifikasi uji', description: 'Mengirim pesan uji ke Telegram.' },
    ],
  },
  {
    group: 'Monitoring & Keamanan',
    items: [
      { key: 'ingestion.manage', label: 'Kelola ingest', description: 'Melihat status ingest, menjalankan ingest manual, dan impor CSV metrik.' },
      { key: 'security.view', label: 'Overview keamanan', description: 'Melihat login gagal, akun terkunci, dan perubahan sensitif.' },
    ],
  },
  {
    group: 'Aset',
    items: [
      { key: 'assets.manage', label: 'Kelola host & aset', description: 'Menambah, mengubah, dan menghapus host serta aset.' },
      { key: 'assets.supervise', label: 'Supervisor aset', description: 'Dapat ditunjuk sebagai supervisor penanggung jawab aset.' },
    ],
  },
  {
    group: 'Lifecycle',
    items: [
      { key: 'lifecycle.request', label: 'Ajukan perpanjangan', description: 'Mengajukan perpanjangan item lifecycle.' },
      { key: 'lifecycle.manage', label: 'Kelola lifecycle', description: 'Menambah dan mengubah item serta memutuskan pengajuan perpanjangan.' },
      { key: 'lifecycle.delete', label: 'Hapus item lifecycle', description: 'Menghapus item lifecycle.' },
    ],
  },
  {
    group: 'Administrasi',
    items: [
      { key: 'thresholds.manage', label: 'Ubah parameter', description: 'Mengubah threshold alert dan batas masa berlaku.' },
      { key: 'users.manage', label: 'Kelola pengguna', description: 'Menambah, mengubah, membuka kunci, dan reset password pengguna.' },
      { key: 'roles.manage', label: 'Kelola role & hak akses', description: 'Membuat role dan mengatur hak aksesnya.' },
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]['items'][number]['key'];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_GROUPS.flatMap((g) => g.items.map((i) => i.key));

const PERMISSION_SET = new Set<string>(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/** Kode role ADMIN: selalu memiliki semua hak akses dan tidak dapat diubah atau dihapus. */
export const ADMIN_ROLE_CODE = 'ADMIN';

/** Data hak akses user yang sedang login (dibaca ulang dari DB setiap request). */
export interface PermissionHolder {
  roleCode: string;
  permissions: readonly string[];
}

/** Hak akses efektif: ADMIN selalu semua, role lain sesuai yang dicentang (kunci usang diabaikan). */
export function effectivePermissions(roleCode: string, stored: readonly string[]): Permission[] {
  if (roleCode === ADMIN_ROLE_CODE) return [...ALL_PERMISSIONS];
  return ALL_PERMISSIONS.filter((p) => stored.includes(p));
}

export function hasPermission(user: PermissionHolder | undefined, permission: Permission): boolean {
  if (!user) return false;
  return user.roleCode === ADMIN_ROLE_CODE || user.permissions.includes(permission);
}

/**
 * Mencegah eskalasi hak akses: actor non-ADMIN hanya boleh memberikan/mengelola role yang
 * hak aksesnya tidak melebihi miliknya, dan tidak pernah role ADMIN.
 */
export function isWithinReach(actor: PermissionHolder, roleCode: string, stored: readonly string[]): boolean {
  if (actor.roleCode === ADMIN_ROLE_CODE) return true;
  if (roleCode === ADMIN_ROLE_CODE) return false;
  return effectivePermissions(roleCode, stored).every((p) => actor.permissions.includes(p));
}

/**
 * Supervisor aset: role non-ADMIN yang dicentang `assets.supervise`. ADMIN sengaja tidak ikut
 * (sama seperti sebelum role dinamis) supaya daftar pilihan supervisor tidak tercampur akun admin.
 */
export function canSupervise(roleCode: string, stored: readonly string[]): boolean {
  return roleCode !== ADMIN_ROLE_CODE && stored.includes('assets.supervise');
}

const MENU_VIEWS: Permission[] = [
  'alerts.view',
  'notifications.view',
  'monitoring.view',
  'backup.view',
  'assets.view',
  'lifecycle.view',
  'reports.view',
];

/**
 * Role bawaan. Hak aksesnya sama dengan aturan @Roles sebelum role dinamis, sehingga perilaku
 * tidak berubah setelah migrasi. Nilai yang sama ditulis di migrasi `dynamic_roles`.
 */
export const SYSTEM_ROLES: { code: string; name: string; description: string; permissions: Permission[] }[] = [
  {
    code: ADMIN_ROLE_CODE,
    name: 'Administrator',
    description: 'Akses penuh ke semua fitur. Hak akses tidak dapat dikurangi.',
    permissions: [...ALL_PERMISSIONS],
  },
  {
    code: 'SUPERVISOR',
    name: 'Supervisor',
    description: 'Supervisor NOC: menangani dan mereview alert, mengelola aset dan lifecycle.',
    permissions: [
      ...MENU_VIEWS,
      'alerts.handle',
      'alerts.review',
      'ingestion.manage',
      'assets.manage',
      'assets.supervise',
      'lifecycle.request',
      'lifecycle.manage',
    ],
  },
  {
    code: 'OPERATOR',
    name: 'Operator NOC',
    description: 'Operator NOC: menangani alert dan mengajukan perpanjangan.',
    permissions: [...MENU_VIEWS, 'alerts.handle', 'ingestion.manage', 'lifecycle.request'],
  },
  {
    code: 'MANAGEMENT',
    name: 'Manajemen',
    description: 'Manajemen TI: hanya membaca dashboard dan laporan.',
    permissions: [...MENU_VIEWS, 'dashboard.executive'],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor',
    description: 'Auditor internal: membaca audit log dan overview keamanan.',
    permissions: [...MENU_VIEWS, 'audit.view', 'security.view'],
  },
];
