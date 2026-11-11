import { AlertStatus, Severity } from '@prisma/client';
import { DEFAULT_POLICIES, nextEscalation, slaState, validatePolicy } from './escalation-rules';

const critical = DEFAULT_POLICIES.find((p) => p.severity === Severity.CRITICAL)!;
const detectedAt = new Date('2026-11-11T08:00:00Z');
const at = (minutes: number) => new Date(detectedAt.getTime() + minutes * 60_000);
const alert = (over: Partial<Parameters<typeof nextEscalation>[0]> = {}) => ({
  status: AlertStatus.NEW,
  conditionActive: true,
  detectedAt,
  acknowledgedAt: null,
  closedAt: null,
  escalationLevel: 0,
  ...over,
});

describe('nextEscalation', () => {
  it('belum waktunya: tidak ada eskalasi', () => {
    expect(nextEscalation(alert(), critical, at(10))).toBeNull();
  });

  it('melewati tingkat 1', () => {
    expect(nextEscalation(alert(), critical, at(16))?.level).toBe(1);
  });

  it('tingkat yang sudah dikirim tidak dikirim ulang', () => {
    expect(nextEscalation(alert({ escalationLevel: 1 }), critical, at(20))).toBeNull();
    expect(nextEscalation(alert({ escalationLevel: 1 }), critical, at(31))?.level).toBe(2);
  });

  it('bila beberapa tingkat terlewati, hanya tingkat tertinggi yang dikirim', () => {
    expect(nextEscalation(alert(), critical, at(125))?.level).toBe(4);
  });

  it('tidak eskalasi untuk alert ditutup, kondisi pulih, atau kebijakan nonaktif', () => {
    expect(nextEscalation(alert({ status: AlertStatus.CLOSED }), critical, at(200))).toBeNull();
    expect(nextEscalation(alert({ conditionActive: false }), critical, at(200))).toBeNull();
    expect(nextEscalation(alert(), { ...critical, enabled: false }, at(200))).toBeNull();
    expect(nextEscalation(alert(), undefined, at(200))).toBeNull();
  });

  it('tetap eskalasi walau sudah diakui selama belum ditutup', () => {
    expect(nextEscalation(alert({ status: AlertStatus.IN_PROGRESS, acknowledgedAt: at(5) }), critical, at(16))?.level).toBe(1);
  });
});

describe('slaState', () => {
  it('belum diakui melewati batas respon', () => {
    const s = slaState(alert(), critical, at(20));
    expect(s.ackBreached).toBe(true);
    expect(s.resolveBreached).toBe(false);
    expect(s.ackDueAt).toEqual(at(15));
  });

  it('diakui tepat waktu dan ditutup terlambat', () => {
    const s = slaState(
      alert({ status: AlertStatus.CLOSED, acknowledgedAt: at(10), closedAt: at(300) }),
      critical,
      at(400),
    );
    expect(s.ackBreached).toBe(false);
    expect(s.resolveBreached).toBe(true);
  });
});

describe('validatePolicy', () => {
  it('menolak batas penyelesaian lebih cepat dari respon', () => {
    expect(validatePolicy({ ackMinutes: 60, resolveMinutes: 30, steps: [] })).toMatch(/penyelesaian/);
  });
  it('menolak waktu tingkat yang tidak naik', () => {
    const steps = [
      { level: 1, afterMinutes: 30, targetLabel: 'A' },
      { level: 2, afterMinutes: 30, targetLabel: 'B' },
    ];
    expect(validatePolicy({ ackMinutes: 15, resolveMinutes: 60, steps })).toMatch(/lebih lama/);
  });
  it('kebijakan default valid', () => {
    for (const p of DEFAULT_POLICIES) expect(validatePolicy(p)).toBeNull();
  });
});
