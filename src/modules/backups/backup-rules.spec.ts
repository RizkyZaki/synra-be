import { BackupStatus, RuleMetric, Severity, ThresholdOperator } from '@prisma/client';
import { backupAgeHours, normalizeBackupDoc, normalizeBackupStatus } from './backup-rules';
import { evaluateAsset } from '../thresholds/threshold-evaluator';
import { DEFAULT_RULES } from '../thresholds/threshold-rules';

const doc = (backup: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  '@timestamp': '2026-11-11T01:05:00.000Z',
  host: { name: 'CBS-DB-01' },
  event: { dataset: 'synra.backup' },
  synra: { backup },
  ...extra,
});

describe('normalizeBackupDoc', () => {
  it('membaca dokumen backup sukses', () => {
    const r = normalizeBackupDoc(
      doc({ job: 'db-full', type: 'full', status: 'success', size_bytes: 1024, duration_s: 61.4, target: 'nas', message: 'abaikan' }),
    );
    expect(r).toMatchObject({
      hostname: 'cbs-db-01',
      jobName: 'db-full',
      type: 'FULL',
      status: BackupStatus.SUCCESS,
      sizeBytes: 1024n,
      durationSec: 61,
      target: 'nas',
      message: null,
    });
    expect(r?.finishedAt.toISOString()).toBe('2026-11-11T01:05:00.000Z');
  });

  it('menyimpan pesan hanya untuk backup gagal', () => {
    const r = normalizeBackupDoc(doc({ job: 'db-log', status: 'FAILED', message: 'disk penuh' }));
    expect(r?.status).toBe(BackupStatus.FAILED);
    expect(r?.message).toBe('disk penuh');
  });

  it('menolak dokumen tanpa job, status, host, atau waktu yang valid', () => {
    expect(normalizeBackupDoc(doc({ status: 'success' }))).toBeNull();
    expect(normalizeBackupDoc(doc({ job: 'x', status: 'running' }))).toBeNull();
    expect(normalizeBackupDoc(doc({ job: 'x', status: 'ok' }, { host: {} }))).toBeNull();
    expect(normalizeBackupDoc(doc({ job: 'x', status: 'ok' }, { '@timestamp': 'bukan tanggal' }))).toBeNull();
  });

  it('jenis yang tidak dikenal menjadi FULL dan ukuran negatif diabaikan', () => {
    const r = normalizeBackupDoc(doc({ job: 'x', status: 'ok', type: 'aneh', size_bytes: -5 }));
    expect(r?.type).toBe('FULL');
    expect(r?.sizeBytes).toBeNull();
  });

  it('normalisasi status', () => {
    expect(normalizeBackupStatus('Completed')).toBe(BackupStatus.SUCCESS);
    expect(normalizeBackupStatus('error')).toBe(BackupStatus.FAILED);
    expect(normalizeBackupStatus(undefined)).toBeNull();
  });
});

describe('backupAgeHours', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  it('dihitung dari sukses terakhir', () => {
    expect(backupAgeHours({ lastSuccessAt: new Date('2026-11-11T09:00:00Z'), firstRunAt: new Date('2026-11-01T00:00:00Z') }, now)).toBe(3);
  });
  it('bila belum pernah sukses, dihitung dari eksekusi pertama', () => {
    expect(backupAgeHours({ lastSuccessAt: null, firstRunAt: new Date('2026-11-10T12:00:00Z') }, now)).toBe(24);
  });
});

describe('evaluateAsset - backup', () => {
  const now = new Date('2026-11-11T12:00:00Z');
  const rules = Object.fromEntries(DEFAULT_RULES.map((r) => [r.metric, r.levels]));
  const asset = {
    id: 'a1',
    hostname: 'cbs-db-01',
    isActive: true,
    dtimeInput: new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: now,
    cpu: 10,
    memory: 10,
    disks: [],
  };

  it('gagal beruntun menghasilkan BACKUP_FAILED dan tidak dobel dengan BACKUP_AGE', () => {
    const f = evaluateAsset(
      { ...asset, backups: [{ jobName: 'db-log', consecutiveFailures: 3, ageHours: 60, lastMessage: 'disk penuh' }] },
      rules,
      now,
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ metric: RuleMetric.BACKUP_FAILED, label: 'db-log', severity: Severity.CRITICAL, value: 3 });
    expect(f[0].problem).toContain('disk penuh');
  });

  it('backup sukses tapi terlalu lama menghasilkan BACKUP_AGE', () => {
    const f = evaluateAsset({ ...asset, backups: [{ jobName: 'db-full', consecutiveFailures: 0, ageHours: 30.5, lastMessage: null }] }, rules, now);
    expect(f).toEqual([expect.objectContaining({ metric: RuleMetric.BACKUP_AGE, severity: Severity.MEDIUM, value: 30 })]);
  });

  it('backup sehat tidak menghasilkan temuan', () => {
    const f = evaluateAsset({ ...asset, backups: [{ jobName: 'db-full', consecutiveFailures: 0, ageHours: 2, lastMessage: null }] }, rules, now);
    expect(f).toEqual([]);
  });

  it('operator GTE dipakai untuk gagal beruntun', () => {
    expect(DEFAULT_RULES.find((r) => r.metric === RuleMetric.BACKUP_FAILED)?.levels[0]).toMatchObject({
      operator: ThresholdOperator.GTE,
      value: 1,
    });
  });
});
