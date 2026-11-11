import { BackupStatus } from '@prisma/client';
import { normalizeHostname } from '../ingestion/normalizer';

/** Penanda dataset Filebeat untuk log hasil backup. */
export const BACKUP_DATASET = 'synra.backup';

/** Field yang dibaca dari dokumen Filebeat. Isi log lain tidak pernah dibaca. */
export const BACKUP_FIELDS = [
  '@timestamp',
  'host.name',
  'synra.backup.job',
  'synra.backup.type',
  'synra.backup.status',
  'synra.backup.started_at',
  'synra.backup.size_bytes',
  'synra.backup.duration_s',
  'synra.backup.target',
  'synra.backup.message',
];

export interface NormalizedBackup {
  hostname: string;
  jobName: string;
  type: string;
  status: BackupStatus;
  startedAt: Date | null;
  finishedAt: Date;
  sizeBytes: bigint | null;
  durationSec: number | null;
  target: string | null;
  message: string | null;
}

const SUCCESS = ['success', 'succeeded', 'ok', 'completed', 'complete', 'done'];
const FAILED = ['failed', 'failure', 'error', 'fail', 'aborted'];
const TYPES = ['FULL', 'INCREMENTAL', 'DIFFERENTIAL', 'SNAPSHOT', 'LOG'];

export function normalizeBackupStatus(raw: unknown): BackupStatus | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (SUCCESS.includes(s)) return BackupStatus.SUCCESS;
  if (FAILED.includes(s)) return BackupStatus.FAILED;
  return null;
}

const text = (v: unknown, max: number) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const date = (v: unknown) => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Mengubah satu dokumen Filebeat (dataset synra.backup) menjadi satu hasil backup.
 * Mengembalikan null bila field wajib (host, job, status, waktu) tidak ada atau tidak valid.
 */
export function normalizeBackupDoc(src: unknown): NormalizedBackup | null {
  const doc = (src ?? {}) as Record<string, unknown>;
  const host = (doc.host ?? {}) as Record<string, unknown>;
  const b = (((doc.synra ?? {}) as Record<string, unknown>).backup ?? {}) as Record<string, unknown>;

  const hostname = normalizeHostname(host.name);
  const jobName = text(b.job, 80);
  const status = normalizeBackupStatus(b.status);
  const finishedAt = date(doc['@timestamp']);
  if (!hostname || !jobName || !status || !finishedAt) return null;

  const type = String(b.type ?? 'FULL').trim().toUpperCase();
  const size = Number(b.size_bytes);
  const duration = Number(b.duration_s);
  return {
    hostname,
    jobName,
    type: TYPES.includes(type) ? type : 'FULL',
    status,
    startedAt: date(b.started_at),
    finishedAt,
    sizeBytes: Number.isFinite(size) && size >= 0 ? BigInt(Math.round(size)) : null,
    durationSec: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    target: text(b.target, 200),
    // Pesan kegagalan saja; pesan sukses tidak diperlukan.
    message: status === BackupStatus.FAILED ? text(b.message, 300) : null,
  };
}

/** Keadaan terkini satu job backup pada satu aset. */
export interface BackupJobState {
  assetId: string;
  jobName: string;
  type: string;
  lastStatus: BackupStatus;
  lastRunAt: Date;
  lastSuccessAt: Date | null;
  firstRunAt: Date;
  consecutiveFailures: number;
  lastMessage: string | null;
  lastSizeBytes: number | null;
  lastDurationSec: number | null;
  target: string | null;
}

/** Jam sejak backup sukses terakhir; bila belum pernah sukses, sejak eksekusi pertama yang tercatat. */
export function backupAgeHours(state: Pick<BackupJobState, 'lastSuccessAt' | 'firstRunAt'>, now: Date): number {
  const ref = state.lastSuccessAt ?? state.firstRunAt;
  return Math.max(0, (now.getTime() - ref.getTime()) / 3_600_000);
}
