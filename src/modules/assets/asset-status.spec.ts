import { Severity } from '@prisma/client';
import { AssetStatus, deriveAssetStatus, maxSeverity } from './asset-status';

describe('status aset', () => {
  const base = { isActive: true, isStale: false, openAlertMaxSeverity: null };

  it.each([
    [{ ...base }, AssetStatus.ONLINE],
    [{ ...base, openAlertMaxSeverity: Severity.INFO }, AssetStatus.ONLINE],
    [{ ...base, openAlertMaxSeverity: Severity.LOW }, AssetStatus.WARNING],
    [{ ...base, openAlertMaxSeverity: Severity.MEDIUM }, AssetStatus.WARNING],
    [{ ...base, openAlertMaxSeverity: Severity.HIGH }, AssetStatus.CRITICAL],
    [{ ...base, openAlertMaxSeverity: Severity.CRITICAL }, AssetStatus.CRITICAL],
    [{ ...base, isStale: true, openAlertMaxSeverity: Severity.LOW }, AssetStatus.STALE],
    [{ ...base, isActive: false, isStale: true }, AssetStatus.INACTIVE],
  ])('%p → %s', (input, expected) => {
    expect(deriveAssetStatus(input)).toBe(expected);
  });

  it('maxSeverity', () => {
    expect(maxSeverity([])).toBeNull();
    expect(maxSeverity([Severity.LOW, Severity.CRITICAL, Severity.MEDIUM])).toBe(Severity.CRITICAL);
  });
});
