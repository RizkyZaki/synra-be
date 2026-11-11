import { Injectable } from '@nestjs/common';
import { AuditAction, LifecycleCategory, LifecycleStatus, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Akun yang tidak login selama ini dianggap tidak aktif dan sebaiknya ditinjau. */
const DORMANT_DAYS = 90;
const CERT_WARNING_DAYS = 30;
const OS_WARNING_DAYS = 90;

/** Aksi yang mengubah hak akses atau konfigurasi keamanan. */
const SENSITIVE_ACTIONS: AuditAction[] = [
  AuditAction.ACCOUNT_LOCKED,
  AuditAction.USER_CREATE,
  AuditAction.USER_UPDATE,
  AuditAction.USER_UNLOCK,
  AuditAction.USER_RESET_PASSWORD,
  AuditAction.PASSWORD_CHANGE,
  AuditAction.THRESHOLD_UPDATE,
  AuditAction.THRESHOLD_CREATE,
  AuditAction.THRESHOLD_DELETE,
  AuditAction.ESCALATION_UPDATE,
];

/**
 * Postur keamanan dari data yang sudah dimiliki SYNRA: percobaan login, status akun,
 * sertifikat SSL/TLS dan OS dari modul siklus hidup, serta perubahan sensitif di audit log.
 */
@Injectable()
export class SecurityService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(now = new Date()) {
    const day = 86_400_000;
    const since24h = new Date(now.getTime() - day);
    const since7d = new Date(now.getTime() - 7 * day);

    const [failed24h, failed7d, success24h, users, certs, osItems, sensitive] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: { action: AuditAction.LOGIN_FAILED, createdAt: { gte: since24h } },
        select: { actorUsername: true, ipAddress: true, createdAt: true },
      }),
      this.prisma.auditLog.count({ where: { action: AuditAction.LOGIN_FAILED, createdAt: { gte: since7d } } }),
      this.prisma.auditLog.count({ where: { action: AuditAction.LOGIN_SUCCESS, createdAt: { gte: since24h } } }),
      this.prisma.user.findMany({
        select: { id: true, username: true, fullName: true, role: true, isActive: true, lockedUntil: true, lastLoginAt: true, failedLoginCount: true },
      }),
      this.prisma.lifecycleItem.findMany({
        where: {
          category: LifecycleCategory.CERTIFICATE,
          status: { in: [LifecycleStatus.ACTIVE, LifecycleStatus.RENEWED] },
          expiryDate: { lte: new Date(now.getTime() + CERT_WARNING_DAYS * day) },
        },
        orderBy: { expiryDate: 'asc' },
        select: { id: true, code: true, name: true, expiryDate: true, picName: true, location: true },
      }),
      this.prisma.lifecycleItem.findMany({
        where: {
          category: LifecycleCategory.OS,
          status: { in: [LifecycleStatus.ACTIVE, LifecycleStatus.RENEWED] },
          expiryDate: { lte: new Date(now.getTime() + OS_WARNING_DAYS * day) },
        },
        orderBy: { expiryDate: 'asc' },
        select: { id: true, code: true, name: true, expiryDate: true, quantity: true, location: true },
      }),
      this.prisma.auditLog.findMany({
        where: { action: { in: SENSITIVE_ACTIONS } },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { id: true, action: true, actorUsername: true, entity: true, entityId: true, ipAddress: true, createdAt: true },
      }),
    ]);

    const daysLeft = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / day);
    const active = users.filter((u) => u.isActive);
    const locked = active.filter((u) => u.lockedUntil && u.lockedUntil > now);
    const dormant = active.filter((u) => !u.lastLoginAt || now.getTime() - u.lastLoginAt.getTime() > DORMANT_DAYS * day);

    return {
      summary: {
        failedLogins24h: failed24h.length,
        failedLogins7d: failed7d,
        successLogins24h: success24h,
        lockedAccounts: locked.length,
        dormantAccounts: dormant.length,
        activeUsers: active.length,
        admins: active.filter((u) => u.role === Role.ADMIN).length,
        certificatesExpiring: certs.filter((c) => daysLeft(c.expiryDate) >= 0).length,
        certificatesExpired: certs.filter((c) => daysLeft(c.expiryDate) < 0).length,
        osEndOfSupport: osItems.filter((o) => daysLeft(o.expiryDate) < 0).length,
        osEndingSoon: osItems.filter((o) => daysLeft(o.expiryDate) >= 0).length,
        dormantAfterDays: DORMANT_DAYS,
      },
      failedLogins: {
        byUsername: topCounts(failed24h.map((f) => f.actorUsername)),
        byIp: topCounts(failed24h.map((f) => f.ipAddress ?? '-')),
        perHour: hourly(failed24h.map((f) => f.createdAt), now),
      },
      lockedAccounts: locked.map((u) => ({ id: u.id, username: u.username, fullName: u.fullName, role: u.role, lockedUntil: u.lockedUntil })),
      dormantAccounts: dormant.map((u) => ({ id: u.id, username: u.username, fullName: u.fullName, role: u.role, lastLoginAt: u.lastLoginAt })),
      certificates: certs.map((c) => ({ ...c, daysLeft: daysLeft(c.expiryDate) })),
      operatingSystems: osItems.map((o) => ({ ...o, daysLeft: daysLeft(o.expiryDate) })),
      sensitiveChanges: sensitive,
    };
  }
}

function topCounts(values: string[], limit = 5) {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

/** Jumlah per jam selama 24 jam terakhir (24 titik, terlama dulu). */
function hourly(dates: Date[], now: Date) {
  const buckets = Array.from({ length: 24 }, (_, i) => ({
    hour: new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000 - (23 - i) * 3_600_000),
    count: 0,
  }));
  const start = buckets[0].hour.getTime();
  for (const d of dates) {
    const idx = Math.floor((d.getTime() - start) / 3_600_000);
    if (idx >= 0 && idx < 24) buckets[idx].count++;
  }
  return buckets;
}
