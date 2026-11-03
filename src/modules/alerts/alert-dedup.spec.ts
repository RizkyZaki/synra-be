import { AlertStatus, RuleMetric, Severity } from '@prisma/client';
import type { Finding } from '../thresholds/threshold-evaluator';
import { dedupKey, planAlertChanges, TRANSITIONS } from './alert-workflow';

function finding(over: Partial<Finding> = {}): Finding {
  return {
    assetId: 'asset-1',
    metric: RuleMetric.CPU,
    label: '',
    severity: Severity.HIGH,
    value: 91,
    threshold: 80,
    problem: 'CPU 91% melewati batas 80%',
    recommendation: '-',
    ...over,
  };
}

describe('deduplikasi alert', () => {
  it('membuat alert baru bila belum ada alert terbuka untuk aset+metrik yang sama', () => {
    const plan = planAlertChanges([finding()], []);
    expect(plan.create).toHaveLength(1);
    expect(plan.update).toHaveLength(0);
  });

  it('tidak membuat alert baru selama alert sebelumnya belum CLOSED', () => {
    const f = finding();
    const plan = planAlertChanges([f], [{ id: 'alert-1', dedupKey: dedupKey(f), severity: Severity.HIGH }]);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toEqual([{ alertId: 'alert-1', finding: f, raiseSeverity: false }]);
  });

  it('menaikkan severity alert yang sudah ada bila kondisi memburuk', () => {
    const f = finding({ metric: RuleMetric.DISK, label: '/data', severity: Severity.CRITICAL, value: 96 });
    const plan = planAlertChanges([f], [{ id: 'alert-1', dedupKey: dedupKey(f), severity: Severity.HIGH }]);
    expect(plan.update[0].raiseSeverity).toBe(true);
  });

  it('tidak menurunkan severity bila kondisi membaik', () => {
    const f = finding({ severity: Severity.LOW });
    const plan = planAlertChanges([f], [{ id: 'alert-1', dedupKey: dedupKey(f), severity: Severity.HIGH }]);
    expect(plan.update[0].raiseSeverity).toBe(false);
  });

  it('metrik atau mount point berbeda pada aset yang sama tetap membuat alert terpisah', () => {
    const cpu = finding();
    const plan = planAlertChanges(
      [cpu, finding({ metric: RuleMetric.MEMORY }), finding({ metric: RuleMetric.DISK, label: '/' }), finding({ metric: RuleMetric.DISK, label: '/data' })],
      [{ id: 'alert-cpu', dedupKey: dedupKey(cpu), severity: Severity.HIGH }],
    );
    expect(plan.update).toHaveLength(1);
    expect(plan.create.map((f) => `${f.metric}${f.label}`)).toEqual(['MEMORY', 'DISK/', 'DISK/data']);
  });

  it('aset berbeda dengan metrik sama tidak saling memblokir', () => {
    const plan = planAlertChanges(
      [finding({ assetId: 'asset-2' })],
      [{ id: 'alert-1', dedupKey: dedupKey(finding()), severity: Severity.HIGH }],
    );
    expect(plan.create).toHaveLength(1);
  });

  it('temuan ganda dalam satu batch digabung menjadi satu alert dengan severity tertinggi', () => {
    const plan = planAlertChanges([finding({ severity: Severity.MEDIUM }), finding({ severity: Severity.CRITICAL })], []);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].severity).toBe(Severity.CRITICAL);
  });

  it('kunci dedup menyertakan aset, metrik, dan label', () => {
    expect(dedupKey({ assetId: 'a', metric: RuleMetric.DISK, label: '/data' })).toBe('a:DISK:/data');
  });
});

describe('alur status alert', () => {
  it('mengikuti urutan NEW → ACKNOWLEDGED → IN_PROGRESS → PENDING_REVIEW → CLOSED', () => {
    expect(TRANSITIONS.acknowledge).toMatchObject({ from: [AlertStatus.NEW], to: AlertStatus.ACKNOWLEDGED });
    expect(TRANSITIONS.start).toMatchObject({ from: [AlertStatus.ACKNOWLEDGED], to: AlertStatus.IN_PROGRESS });
    expect(TRANSITIONS.submitReview).toMatchObject({ from: [AlertStatus.IN_PROGRESS], to: AlertStatus.PENDING_REVIEW });
    expect(TRANSITIONS.return).toMatchObject({ from: [AlertStatus.PENDING_REVIEW], to: AlertStatus.IN_PROGRESS });
    expect(TRANSITIONS.close.to).toBe(AlertStatus.CLOSED);
  });

  it('penutupan selalu wajib catatan dan tidak bisa dari status CLOSED', () => {
    expect(TRANSITIONS.close.noteRequired).toBe(true);
    expect(TRANSITIONS.close.from).not.toContain(AlertStatus.CLOSED);
  });

  it('review wajib catatan dan bukti remediasi', () => {
    expect(TRANSITIONS.submitReview).toMatchObject({ noteRequired: true, evidenceRequired: true });
  });
});
