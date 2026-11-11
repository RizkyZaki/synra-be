import { daysBetween, expiryLevel, nextCode, renewalCode, todayIn } from './lifecycle-rules';

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
