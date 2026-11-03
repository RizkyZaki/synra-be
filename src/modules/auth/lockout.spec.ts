import { isLocked, registerFailure } from './lockout';

describe('lockout', () => {
  const policy = { maxAttempts: 5, lockoutMinutes: 15 };
  const now = new Date('2026-11-02T08:00:00Z');
  const fresh = { failedLoginCount: 0, lockedUntil: null };

  it('menambah hitungan gagal dan menghitung sisa percobaan', () => {
    const next = registerFailure(fresh, policy, now);
    expect(next).toMatchObject({ failedLoginCount: 1, lockedUntil: null, justLocked: false, remaining: 4 });
  });

  it('mengunci akun pada kegagalan ke-5', () => {
    let state: { failedLoginCount: number; lockedUntil: Date | null } = fresh;
    let last = registerFailure(state, policy, now);
    for (let i = 1; i < 5; i++) {
      state = last;
      last = registerFailure(state, policy, now);
    }
    expect(last.justLocked).toBe(true);
    expect(last.lockedUntil).toEqual(new Date('2026-11-02T08:15:00Z'));
    expect(last.failedLoginCount).toBe(0);
  });

  it('tidak mengunci pada kegagalan ke-4', () => {
    const next = registerFailure({ failedLoginCount: 3, lockedUntil: null }, policy, now);
    expect(next.justLocked).toBe(false);
    expect(next.remaining).toBe(1);
  });

  it('memulai hitungan dari nol setelah masa kunci habis', () => {
    const expired = { failedLoginCount: 0, lockedUntil: new Date('2026-11-02T07:59:00Z') };
    const next = registerFailure(expired, policy, now);
    expect(next).toMatchObject({ failedLoginCount: 1, lockedUntil: null, justLocked: false });
  });

  it('isLocked hanya true selama lockedUntil di masa depan', () => {
    expect(isLocked(fresh, now)).toBe(false);
    expect(isLocked({ failedLoginCount: 0, lockedUntil: new Date('2026-11-02T08:10:00Z') }, now)).toBe(true);
    expect(isLocked({ failedLoginCount: 0, lockedUntil: now }, now)).toBe(false);
  });
});
