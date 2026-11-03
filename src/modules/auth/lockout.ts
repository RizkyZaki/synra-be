export interface LockoutState {
  failedLoginCount: number;
  lockedUntil: Date | null;
}

export interface LockoutPolicy {
  maxAttempts: number;
  lockoutMinutes: number;
}

export function isLocked(state: LockoutState, now: Date): boolean {
  return state.lockedUntil !== null && state.lockedUntil.getTime() > now.getTime();
}

/**
 * Menghitung state baru setelah satu kali login gagal.
 * Jika lock sebelumnya sudah kedaluwarsa, hitungan dimulai dari nol lagi.
 */
export function registerFailure(
  state: LockoutState,
  policy: LockoutPolicy,
  now: Date,
): LockoutState & { justLocked: boolean; remaining: number } {
  const expiredLock = state.lockedUntil !== null && !isLocked(state, now);
  const count = (expiredLock ? 0 : state.failedLoginCount) + 1;

  if (count >= policy.maxAttempts) {
    return {
      failedLoginCount: 0,
      lockedUntil: new Date(now.getTime() + policy.lockoutMinutes * 60_000),
      justLocked: true,
      remaining: 0,
    };
  }
  return {
    failedLoginCount: count,
    lockedUntil: null,
    justLocked: false,
    remaining: policy.maxAttempts - count,
  };
}
