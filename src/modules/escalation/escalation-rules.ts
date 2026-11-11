import { AlertStatus, Severity } from '@prisma/client';

export interface StepRule {
  level: number;
  afterMinutes: number;
  targetLabel: string;
  mention?: string | null;
  telegramChatId?: string | null;
}

export interface PolicyRule {
  severity: Severity;
  ackMinutes: number;
  resolveMinutes: number;
  enabled: boolean;
  steps: StepRule[];
}

/** Matriks default (dapat diubah ADMIN). Waktu dalam menit sejak alert terdeteksi. */
export const DEFAULT_POLICIES: PolicyRule[] = [
  {
    severity: Severity.CRITICAL,
    ackMinutes: 15,
    resolveMinutes: 240,
    enabled: true,
    steps: [
      { level: 1, afterMinutes: 15, targetLabel: 'Supervisor NOC' },
      { level: 2, afterMinutes: 30, targetLabel: 'Kepala Departemen Infrastruktur' },
      { level: 3, afterMinutes: 60, targetLabel: 'Kepala Divisi TI' },
      { level: 4, afterMinutes: 120, targetLabel: 'Manajemen' },
    ],
  },
  {
    severity: Severity.HIGH,
    ackMinutes: 30,
    resolveMinutes: 480,
    enabled: true,
    steps: [
      { level: 1, afterMinutes: 60, targetLabel: 'Supervisor NOC' },
      { level: 2, afterMinutes: 120, targetLabel: 'Kepala Departemen Infrastruktur' },
    ],
  },
  {
    severity: Severity.MEDIUM,
    ackMinutes: 120,
    resolveMinutes: 1440,
    enabled: true,
    steps: [{ level: 1, afterMinutes: 480, targetLabel: 'Supervisor NOC' }],
  },
  {
    severity: Severity.LOW,
    ackMinutes: 480,
    resolveMinutes: 4320,
    enabled: true,
    steps: [{ level: 1, afterMinutes: 1440, targetLabel: 'Supervisor NOC' }],
  },
  { severity: Severity.INFO, ackMinutes: 1440, resolveMinutes: 10080, enabled: false, steps: [] },
];

export interface AlertClock {
  status: AlertStatus;
  conditionActive: boolean;
  detectedAt: Date;
  acknowledgedAt: Date | null;
  closedAt: Date | null;
  escalationLevel: number;
}

const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

/** Tenggat SLA dan apakah sudah terlewati. Alert yang sudah diakui/ditutup dinilai pada waktu kejadiannya. */
export function slaState(alert: AlertClock, policy: Pick<PolicyRule, 'ackMinutes' | 'resolveMinutes'>, now: Date) {
  const ackDueAt = addMinutes(alert.detectedAt, policy.ackMinutes);
  const resolveDueAt = addMinutes(alert.detectedAt, policy.resolveMinutes);
  const ackAt = alert.acknowledgedAt ?? (alert.status === AlertStatus.NEW ? now : alert.detectedAt);
  const resolveAt = alert.closedAt ?? now;
  return {
    ackDueAt,
    resolveDueAt,
    ackBreached: ackAt > ackDueAt,
    resolveBreached: resolveAt > resolveDueAt,
  };
}

/**
 * Tingkat eskalasi berikutnya yang harus dikirim, atau null.
 * Eskalasi berjalan selama alert belum ditutup dan kondisinya masih aktif. Bila beberapa tingkat
 * terlewati sekaligus (mis. backend sempat mati), hanya tingkat tertinggi yang dikirim.
 */
export function nextEscalation(alert: AlertClock, policy: PolicyRule | undefined, now: Date): StepRule | null {
  if (!policy?.enabled || alert.status === AlertStatus.CLOSED || !alert.conditionActive) return null;
  const ageMinutes = (now.getTime() - alert.detectedAt.getTime()) / 60_000;
  const due = policy.steps.filter((s) => s.level > alert.escalationLevel && s.afterMinutes <= ageMinutes);
  if (due.length === 0) return null;
  return due.reduce((a, b) => (b.level > a.level ? b : a));
}

/** Validasi kebijakan. Mengembalikan pesan error atau null. */
export function validatePolicy(p: Pick<PolicyRule, 'ackMinutes' | 'resolveMinutes' | 'steps'>): string | null {
  if (p.resolveMinutes < p.ackMinutes) return 'Batas penyelesaian tidak boleh lebih cepat dari batas respon.';
  for (let i = 1; i < p.steps.length; i++) {
    if (p.steps[i].afterMinutes <= p.steps[i - 1].afterMinutes) {
      return 'Waktu setiap tingkat eskalasi harus lebih lama dari tingkat sebelumnya.';
    }
  }
  return null;
}
