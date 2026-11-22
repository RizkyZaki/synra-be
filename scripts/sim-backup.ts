/**
 * Skenario job backup contoh, dipakai bersama oleh simulator (Elasticsearch) dan seed backup (Postgres)
 * agar keduanya menghasilkan riwayat yang sama. Semua data adalah contoh untuk development.
 */
import { SIM_ASSETS, SimAsset, isSending } from './sim-hosts';

export const HOUR = 3_600_000;

export interface BackupJob {
  name: string;
  type: string;
  everyMs: number;
  /** Ukuran rata-rata dalam GB */
  sizeGb: number;
  target: string;
}

export interface SimBackupRun {
  jobName: string;
  type: string;
  status: 'SUCCESS' | 'FAILED';
  startedAt: Date;
  finishedAt: Date;
  sizeBytes: number;
  durationSec: number;
  target: string;
  message: string | null;
}

/** Job backup per aset: database punya full harian + archive log per jam, lainnya snapshot konfigurasi. */
export function backupJobs(host: SimAsset): BackupJob[] {
  if (host.backup === 'none') return [];
  if (host.component === 'DATABASE') {
    return [
      { name: 'db-full', type: 'FULL', everyMs: 24 * HOUR, sizeGb: 180, target: 'nas-dc1:/backup/db' },
      { name: 'db-archivelog', type: 'LOG', everyMs: HOUR, sizeGb: 2.5, target: 'nas-dc1:/backup/arch' },
    ];
  }
  return [{ name: 'config-snapshot', type: 'SNAPSHOT', everyMs: 6 * HOUR, sizeGb: 0.4, target: 'nas-dc1:/backup/config' }];
}

/** Pesan kegagalan bila job gagal pada waktu t (skenario "failing"), selain itu null. */
function failure(host: SimAsset, job: BackupJob, t: number): string | null {
  if (host.backup !== 'failing') return null;
  if (job.name === 'db-archivelog' && Date.now() - t < 4 * HOUR) return 'No space left on device: /backup/arch';
  if (job.name === 'config-snapshot' && Date.now() - t < 6 * HOUR) return 'Koneksi ke nas-dc1 timeout setelah 30 detik';
  return null;
}

/** Hasil satu eksekusi job yang selesai pada waktu t. */
export function backupRun(host: SimAsset, job: BackupJob, t: number): SimBackupRun {
  const error = failure(host, job, t);
  const seed = [...(host.hostname + job.name)].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const duration = Math.round(job.sizeGb * 20 + (seed % 60));
  const size = Math.round(job.sizeGb * (0.95 + ((t / HOUR + seed) % 10) / 100) * 1024 ** 3);
  return {
    jobName: job.name,
    type: job.type,
    status: error ? 'FAILED' : 'SUCCESS',
    startedAt: new Date(t - duration * 1000),
    finishedAt: new Date(t),
    sizeBytes: error ? 0 : size,
    durationSec: duration,
    target: job.target,
    message: error,
  };
}

/** Semua eksekusi job yang jatuh di (from, to]. Jadwal digeser 5 menit dari jam bulat. */
export function backupRunsBetween(from: number, to: number, assets: SimAsset[] = SIM_ASSETS) {
  const offset = 5 * 60_000;
  const runs: { host: SimAsset; run: SimBackupRun }[] = [];
  for (const host of assets) {
    for (const job of backupJobs(host)) {
      for (let k = Math.floor((from - offset) / job.everyMs) + 1; k * job.everyMs + offset <= to; k++) {
        const t = k * job.everyMs + offset;
        if (t <= from || !isSending(host, t)) continue;
        runs.push({ host, run: backupRun(host, job, t) });
      }
    }
  }
  return runs;
}
