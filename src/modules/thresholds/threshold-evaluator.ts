import { RuleMetric, Severity } from '@prisma/client';
import { DEFAULT_RECOMMENDATION, matchLevel, RuleLevel } from './threshold-rules';

export interface EvaluatedAsset {
  id: string;
  hostname: string;
  isActive: boolean;
  dtimeInput: Date;
  lastSeenAt: Date | null;
  cpu: number | null;
  memory: number | null;
  disks: { mountPoint: string; value: number }[];
  /** Keadaan job backup aset ini (kosong bila aset tidak punya job backup) */
  backups?: EvaluatedBackupJob[];
}

export interface EvaluatedBackupJob {
  jobName: string;
  consecutiveFailures: number;
  /** Jam sejak backup sukses terakhir */
  ageHours: number;
  lastMessage: string | null;
}

export interface Finding {
  assetId: string;
  metric: RuleMetric;
  /** Mount point untuk DISK, "" untuk lainnya */
  label: string;
  severity: Severity;
  value: number;
  threshold: number;
  problem: string;
  recommendation: string;
}

export type RulesByMetric = Partial<Record<RuleMetric, RuleLevel[]>>;

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('id-ID');

/** Menit sejak data terakhir. Aset yang belum pernah mengirim data dihitung sejak didaftarkan. */
export function minutesSinceSeen(asset: Pick<EvaluatedAsset, 'lastSeenAt' | 'dtimeInput'>, now: Date): number {
  const ref = asset.lastSeenAt ?? asset.dtimeInput;
  return Math.max(0, (now.getTime() - ref.getTime()) / 60_000);
}

/** Batas stale (menit) = level HOST_STALE aktif dengan nilai terkecil; default 5. */
export function staleLimitMinutes(rules: RulesByMetric): number {
  const active = (rules.HOST_STALE ?? []).filter((l) => l.enabled).map((l) => l.value);
  return active.length > 0 ? Math.min(...active) : 5;
}

/**
 * Mengevaluasi satu aset terhadap aturan threshold. Pure function: tanpa I/O.
 * Aset nonaktif dilewati. Aset stale hanya menghasilkan temuan HOST_STALE karena
 * metrik terakhirnya sudah tidak mewakili kondisi saat ini.
 */
export function evaluateAsset(asset: EvaluatedAsset, rules: RulesByMetric, now: Date): Finding[] {
  if (!asset.isActive) return [];
  const findings: Finding[] = [];
  const push = (metric: RuleMetric, label: string, value: number, problem: (t: number) => string) => {
    const level = matchLevel(value, rules[metric] ?? []);
    if (!level) return;
    findings.push({
      assetId: asset.id,
      metric,
      label,
      severity: level.severity,
      value,
      threshold: level.value,
      problem: problem(level.value),
      recommendation: level.recommendation || DEFAULT_RECOMMENDATION[metric],
    });
  };

  const staleMinutes = minutesSinceSeen(asset, now);
  push(RuleMetric.HOST_STALE, '', Math.floor(staleMinutes), (t) =>
    asset.lastSeenAt
      ? `Tidak ada data dari ${asset.hostname} selama ${Math.floor(staleMinutes)} menit (batas ${fmt(t)} menit)`
      : `Belum pernah ada data dari ${asset.hostname} sejak didaftarkan (${Math.floor(staleMinutes)} menit, batas ${fmt(t)} menit)`,
  );
  if (staleMinutes > staleLimitMinutes(rules)) return findings;

  if (asset.cpu !== null) {
    push(RuleMetric.CPU, '', asset.cpu, (t) => `CPU ${fmt(asset.cpu!)}% melewati batas ${fmt(t)}%`);
  }
  if (asset.memory !== null) {
    push(RuleMetric.MEMORY, '', asset.memory, (t) => `Memori ${fmt(asset.memory!)}% melewati batas ${fmt(t)}%`);
  }
  for (const d of asset.disks) {
    push(RuleMetric.DISK, d.mountPoint, d.value, (t) => `Disk ${d.mountPoint} terpakai ${fmt(d.value)}% (batas ${fmt(t)}%)`);
  }
  for (const b of asset.backups ?? []) {
    const before = findings.length;
    if (b.consecutiveFailures > 0) {
      push(RuleMetric.BACKUP_FAILED, b.jobName, b.consecutiveFailures, () =>
        `Backup "${b.jobName}" gagal ${b.consecutiveFailures} kali beruntun${b.lastMessage ? `: ${b.lastMessage}` : ''}`,
      );
    }
    // Bila sudah ada temuan "gagal" untuk job ini, temuan umur tidak ditambahkan agar tidak dobel.
    if (findings.length === before) {
      const hours = Math.floor(b.ageHours);
      push(RuleMetric.BACKUP_AGE, b.jobName, hours, (t) =>
        `Tidak ada backup "${b.jobName}" yang berhasil selama ${hours} jam (batas ${fmt(t)} jam)`,
      );
    }
  }
  return findings;
}
