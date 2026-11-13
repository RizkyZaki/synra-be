import { daysBetween, expiryLevel, nextCode, renewalCode, todayIn, validateExpiryThresholds } from './lifecycle-rules';

describe('lifecycle rules', () => {
  it('menentukan tingkat urgensi dari sisa hari', () => {
    expect(expiryLevel(-1)).toBe('EXPIRED');
    expect(expiryLevel(0)).toBe('CRITICAL');
    expect(expiryLevel(30)).toBe('CRITICAL');
    expect(expiryLevel(31)).toBe('HIGH');
    expect(expiryLevel(90)).toBe('HIGH');
    expect(expiryLevel(180)).toBe('MEDIUM');
    expect(expiryLevel(365)).toBe('LOW');
    expect(expiryLevel(366)).toBe('INFO');
  });

  it('memakai batas hari yang diatur admin', () => {
    const t = { CRITICAL: 14, HIGH: 60, MEDIUM: 120, LOW: 200 };
    expect(expiryLevel(14, t)).toBe('CRITICAL');
    expect(expiryLevel(15, t)).toBe('HIGH');
    expect(expiryLevel(60, t)).toBe('HIGH');
    expect(expiryLevel(121, t)).toBe('LOW');
    expect(expiryLevel(201, t)).toBe('INFO');
  });

  it('memvalidasi urutan dan rentang batas hari', () => {
    expect(validateExpiryThresholds({ CRITICAL: 30, HIGH: 90, MEDIUM: 180, LOW: 365 })).toBeNull();
    expect(validateExpiryThresholds({ CRITICAL: 90, HIGH: 90, MEDIUM: 180, LOW: 365 })).not.toBeNull();
    expect(validateExpiryThresholds({ CRITICAL: 30, HIGH: 20, MEDIUM: 180, LOW: 365 })).not.toBeNull();
    expect(validateExpiryThresholds({ CRITICAL: -1, HIGH: 90, MEDIUM: 180, LOW: 365 })).not.toBeNull();
    expect(validateExpiryThresholds({ CRITICAL: 1.5, HIGH: 90, MEDIUM: 180, LOW: 365 })).not.toBeNull();
  });

  it('menghitung selisih hari kalender', () => {
    expect(daysBetween('2026-11-11', '2026-11-11')).toBe(0);
    expect(daysBetween('2026-11-11', '2026-12-11')).toBe(30);
    expect(daysBetween('2026-11-11', '2026-11-01')).toBe(-10);
  });

  it('memakai tanggal Jakarta, bukan UTC', () => {
    // 2026-11-10 20:00 UTC = 2026-11-11 03:00 WIB
    expect(todayIn('Asia/Jakarta', new Date('2026-11-10T20:00:00Z'))).toBe('2026-11-11');
  });

  it('membuat kode berikutnya per kategori', () => {
    expect(nextCode('LICENSE', [])).toBe('LIC-001');
    expect(nextCode('LICENSE', ['LIC-001', 'LIC-009', 'CRT-020'])).toBe('LIC-010');
    expect(nextCode('CERTIFICATE', ['LIC-001'])).toBe('CRT-001');
    expect(renewalCode(7)).toBe('REQ-007');
  });
});
