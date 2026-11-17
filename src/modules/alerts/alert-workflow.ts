import { AlertAction, AlertStatus, Severity } from '@prisma/client';
import { Permission } from '../../common/permissions';
import { SEVERITY_RANK } from '../assets/asset-status';
import type { Finding } from '../thresholds/threshold-evaluator';

export type TransitionName = 'acknowledge' | 'start' | 'submitReview' | 'return' | 'close';

export interface TransitionRule {
  from: AlertStatus[];
  to: AlertStatus;
  action: AlertAction;
  /** Hak akses yang dibutuhkan (dicek oleh @RequirePermission di controller) */
  permission: Permission;
  noteRequired: boolean;
  evidenceRequired: boolean;
}

const OPEN: AlertStatus[] = [
  AlertStatus.NEW,
  AlertStatus.ACKNOWLEDGED,
  AlertStatus.IN_PROGRESS,
  AlertStatus.PENDING_REVIEW,
];

/**
 * Alur status alert:
 * NEW → ACKNOWLEDGED → IN_PROGRESS → PENDING_REVIEW → CLOSED, dengan PENDING_REVIEW → IN_PROGRESS (dikembalikan).
 * Reviewer (alerts.review) juga dapat menutup langsung dari status terbuka mana pun (mis. false positive); catatan selalu wajib.
 */
export const TRANSITIONS: Record<TransitionName, TransitionRule> = {
  acknowledge: {
    from: [AlertStatus.NEW],
    to: AlertStatus.ACKNOWLEDGED,
    action: AlertAction.ACKNOWLEDGED,
    permission: 'alerts.handle',
    noteRequired: false,
    evidenceRequired: false,
  },
  start: {
    from: [AlertStatus.ACKNOWLEDGED],
    to: AlertStatus.IN_PROGRESS,
    action: AlertAction.STARTED,
    permission: 'alerts.handle',
    noteRequired: true,
    evidenceRequired: false,
  },
  submitReview: {
    from: [AlertStatus.IN_PROGRESS],
    to: AlertStatus.PENDING_REVIEW,
    action: AlertAction.SUBMITTED_REVIEW,
    permission: 'alerts.handle',
    noteRequired: true,
    evidenceRequired: true,
  },
  return: {
    from: [AlertStatus.PENDING_REVIEW],
    to: AlertStatus.IN_PROGRESS,
    action: AlertAction.RETURNED,
    permission: 'alerts.review',
    noteRequired: true,
    evidenceRequired: false,
  },
  close: {
    from: OPEN,
    to: AlertStatus.CLOSED,
    action: AlertAction.CLOSED,
    permission: 'alerts.review',
    noteRequired: true,
    evidenceRequired: false,
  },
};

export function dedupKey(f: Pick<Finding, 'assetId' | 'metric' | 'label'>): string {
  return `${f.assetId}:${f.metric}:${f.label}`;
}

export interface OpenAlertRef {
  id: string;
  dedupKey: string;
  severity: Severity;
}

export interface AlertPlan {
  create: Finding[];
  update: { alertId: string; finding: Finding; raiseSeverity: boolean }[];
}

/**
 * Deduplikasi: temuan dengan aset+metrik+label yang masih punya alert belum CLOSED tidak membuat
 * alert baru, melainkan memperbarui nilai terakhir (dan menaikkan severity bila memburuk).
 * Temuan ganda dalam satu batch untuk kunci yang sama digabung, diambil severity tertinggi.
 */
export function planAlertChanges(findings: Finding[], openAlerts: OpenAlertRef[]): AlertPlan {
  const open = new Map(openAlerts.map((a) => [a.dedupKey, a]));
  const strongest = new Map<string, Finding>();
  for (const f of findings) {
    const key = dedupKey(f);
    const prev = strongest.get(key);
    if (!prev || SEVERITY_RANK[f.severity] > SEVERITY_RANK[prev.severity]) strongest.set(key, f);
  }

  const plan: AlertPlan = { create: [], update: [] };
  for (const [key, f] of strongest) {
    const existing = open.get(key);
    if (existing) {
      plan.update.push({
        alertId: existing.id,
        finding: f,
        raiseSeverity: SEVERITY_RANK[f.severity] > SEVERITY_RANK[existing.severity],
      });
    } else {
      plan.create.push(f);
    }
  }
  return plan;
}
