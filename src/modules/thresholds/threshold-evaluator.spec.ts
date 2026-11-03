import { RuleMetric, Severity, ThresholdOperator } from '@prisma/client';
import { DEFAULT_RULES, matchLevel, RuleLevel, validateLevels } from './threshold-rules';
import { evaluateAsset, EvaluatedAsset, RulesByMetric, staleLimitMinutes } from './threshold-evaluator';

const defaults: RulesByMetric = Object.fromEntries(DEFAULT_RULES.map((r) => [r.metric, r.levels]));
const now = new Date('2026-11-02T08:00:00Z');
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

function asset(over: Partial<EvaluatedAsset> = {}): EvaluatedAsset {
  return {
    id: 'a1',
    hostname: 'cbs-app-01',
    isActive: true,
    createdAt: minutesAgo(10_000),
    lastSeenAt: minutesAgo(1),
    cpu: 20,
    memory: 40,
    disks: [{ mountPoint: '/', value: 50 }],
    ...over,
  };
}

const level = (severity: Severity, value: number, operator: ThresholdOperator = ThresholdOperator.GTE, enabled = true): RuleLevel => ({
  severity,
  value,
  operator,
  enabled,
});

describe('evaluasi threshold', () => {
  describe('nilai default sesuai spesifikasi', () => {
    it('CPU > 80% menghasilkan HIGH, tepat 80% tidak', () => {
      expect(evaluateAsset(asset({ cpu: 80 }), defaults, now)).toEqual([]);
      const [f] = evaluateAsset(asset({ cpu: 80.5 }), defaults, now);
      expect(f).toMatchObject({ metric: RuleMetric.CPU, severity: Severity.HIGH, value: 80.5, threshold: 80 });
    });

    it('memori > 85% menghasilkan HIGH', () => {
      const [f] = evaluateAsset(asset({ memory: 90 }), defaults, now);
      expect(f).toMatchObject({ metric: RuleMetric.MEMORY, severity: Severity.HIGH, threshold: 85 });
    });

    it.each([
      [69.9, null],
      [70, Severity.LOW],
      [80, Severity.MEDIUM],
      [89.9, Severity.MEDIUM],
      [90, Severity.HIGH],
      [95, Severity.CRITICAL],
      [99, Severity.CRITICAL],
    ])('disk %p%% → %p', (value, expected) => {
      const findings = evaluateAsset(asset({ disks: [{ mountPoint: '/data', value }] }), defaults, now);
      if (expected === null) expect(findings).toEqual([]);
      else expect(findings).toEqual([expect.objectContaining({ metric: RuleMetric.DISK, label: '/data', severity: expected })]);
    });

    it('mengevaluasi setiap mount point secara terpisah', () => {
      const findings = evaluateAsset(
        asset({ disks: [{ mountPoint: '/', value: 72 }, { mountPoint: '/data', value: 96 }] }),
        defaults,
        now,
      );
      expect(findings.map((f) => [f.label, f.severity])).toEqual([
        ['/', Severity.LOW],
        ['/data', Severity.CRITICAL],
      ]);
    });
  });

  describe('host stale', () => {
    it('lebih dari 5 menit tanpa data → CRITICAL, dan metrik lama tidak dievaluasi', () => {
      const findings = evaluateAsset(asset({ lastSeenAt: minutesAgo(12), cpu: 99 }), defaults, now);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ metric: RuleMetric.HOST_STALE, severity: Severity.CRITICAL, value: 12 });
    });

    it('tepat 5 menit belum stale', () => {
      expect(evaluateAsset(asset({ lastSeenAt: minutesAgo(5) }), defaults, now)).toEqual([]);
    });

    it('aset yang belum pernah mengirim data dihitung sejak didaftarkan', () => {
      expect(evaluateAsset(asset({ lastSeenAt: null, createdAt: minutesAgo(2), cpu: null, memory: null, disks: [] }), defaults, now)).toEqual([]);
      const [f] = evaluateAsset(asset({ lastSeenAt: null, createdAt: minutesAgo(30) }), defaults, now);
      expect(f.metric).toBe(RuleMetric.HOST_STALE);
      expect(f.problem).toContain('Belum pernah ada data');
    });

    it('batas stale mengikuti level HOST_STALE aktif terkecil', () => {
      expect(staleLimitMinutes(defaults)).toBe(5);
      expect(staleLimitMinutes({ HOST_STALE: [level(Severity.HIGH, 10), level(Severity.CRITICAL, 30)] })).toBe(10);
      expect(staleLimitMinutes({})).toBe(5);
    });
  });

  it('aset nonaktif tidak dievaluasi', () => {
    expect(evaluateAsset(asset({ isActive: false, cpu: 99, lastSeenAt: minutesAgo(100) }), defaults, now)).toEqual([]);
  });

  it('memakai rekomendasi dari aturan bila ada', () => {
    const rules: RulesByMetric = { CPU: [{ ...level(Severity.HIGH, 50, ThresholdOperator.GT), recommendation: 'Restart service X' }] };
    expect(evaluateAsset(asset({ cpu: 60 }), rules, now)[0].recommendation).toBe('Restart service X');
  });

  describe('matchLevel', () => {
    const levels = [level(Severity.LOW, 70), level(Severity.HIGH, 90), level(Severity.MEDIUM, 80)];

    it('memilih severity tertinggi yang terlampaui, apa pun urutan input', () => {
      expect(matchLevel(91, levels)?.severity).toBe(Severity.HIGH);
      expect(matchLevel(85, levels)?.severity).toBe(Severity.MEDIUM);
    });

    it('mengabaikan level nonaktif', () => {
      expect(matchLevel(91, [level(Severity.LOW, 70), level(Severity.HIGH, 90, ThresholdOperator.GTE, false)])?.severity).toBe(Severity.LOW);
    });

    it('membedakan GT dan GTE', () => {
      expect(matchLevel(80, [level(Severity.HIGH, 80, ThresholdOperator.GT)])).toBeNull();
      expect(matchLevel(80, [level(Severity.HIGH, 80, ThresholdOperator.GTE)])).not.toBeNull();
    });
  });

  describe('validasi konfigurasi', () => {
    it('menerima nilai default', () => {
      for (const r of DEFAULT_RULES) expect(validateLevels(r.metric, r.levels)).toBeNull();
    });

    it('menolak level yang tidak berurutan', () => {
      const error = validateLevels(RuleMetric.DISK, [level(Severity.LOW, 70), level(Severity.MEDIUM, 90), level(Severity.HIGH, 80)]);
      expect(error).toContain('harus naik');
    });

    it('menolak nilai sama untuk dua severity', () => {
      expect(validateLevels(RuleMetric.DISK, [level(Severity.LOW, 80), level(Severity.HIGH, 80)])).toContain('harus naik');
    });

    it('level nonaktif tidak ikut dicek urutannya', () => {
      expect(validateLevels(RuleMetric.DISK, [level(Severity.LOW, 70), level(Severity.MEDIUM, 60, ThresholdOperator.GTE, false), level(Severity.HIGH, 90)])).toBeNull();
    });

    it('menolak severity ganda, persen di luar 0–100, dan set kosong', () => {
      expect(validateLevels(RuleMetric.CPU, [level(Severity.HIGH, 80), level(Severity.HIGH, 90)])).toContain('ganda');
      expect(validateLevels(RuleMetric.CPU, [level(Severity.HIGH, 120)])).toContain('0 dan 100');
      expect(validateLevels(RuleMetric.CPU, [])).toContain('Minimal satu');
    });

    it('menolak host stale di luar 1–1440 menit', () => {
      expect(validateLevels(RuleMetric.HOST_STALE, [level(Severity.CRITICAL, 0)])).toContain('1 dan 1440');
      expect(validateLevels(RuleMetric.HOST_STALE, [level(Severity.CRITICAL, 5)])).toBeNull();
    });
  });
});
