import { AlertAction, Severity } from '@prisma/client';

export interface AlertMessageInput {
  number: number;
  severity: Severity;
  problem: string;
  value: number;
  picName: string;
  recommendation: string;
  detectedAt: Date;
  asset: { hostname: string; ipAddress: string; component: string; host: { name: string } };
}

const ICON: Record<Severity, string> = {
  INFO: '🔵',
  LOW: '🟢',
  MEDIUM: '🟡',
  HIGH: '🟠',
  CRITICAL: '🔴',
};

const TITLE: Record<AlertAction, string> = {
  CREATED: 'ALERT BARU',
  ACKNOWLEDGED: 'Alert diakui',
  STARTED: 'Alert dalam penanganan',
  SUBMITTED_REVIEW: 'Alert menunggu review penutupan',
  RETURNED: 'Alert dikembalikan ke penanganan',
  CLOSED: 'Alert ditutup',
  SEVERITY_RAISED: 'Severity alert naik',
};

export const alertCode = (n: number) => `ALT-${String(n).padStart(3, '0')}`;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formatJakarta(d: Date, timeZone = 'Asia/Jakarta'): string {
  return d.toLocaleString('id-ID', { timeZone, dateStyle: 'medium', timeStyle: 'short' }) + ' WIB';
}

/** Menyusun pesan Telegram (HTML) untuk satu peristiwa alert. */
export function buildAlertMessage(
  alert: AlertMessageInput,
  event: AlertAction,
  ctx: { actor?: string; note?: string | null } = {},
): string {
  const e = escapeHtml;
  const lines = [
    `${ICON[alert.severity]} <b>[${alert.severity}] ${TITLE[event]}</b> — ${alertCode(alert.number)}`,
    '',
    `<b>Aset:</b> ${e(alert.asset.hostname)} (${e(alert.asset.ipAddress)})`,
    `<b>Host:</b> ${e(alert.asset.host.name)} · <b>Komponen:</b> ${e(alert.asset.component)}`,
    `<b>Masalah:</b> ${e(alert.problem)}`,
  ];
  if (event === AlertAction.CREATED) {
    lines.push(
      `<b>Nilai:</b> ${Math.round(alert.value * 100) / 100}`,
      `<b>PIC:</b> ${e(alert.picName)}`,
      `<b>Waktu deteksi:</b> ${formatJakarta(alert.detectedAt)}`,
      `<b>Rekomendasi:</b> ${e(alert.recommendation)}`,
    );
  } else {
    if (ctx.actor) lines.push(`<b>Oleh:</b> ${e(ctx.actor)}`);
    if (ctx.note) lines.push(`<b>Catatan:</b> ${e(ctx.note)}`);
  }
  return lines.join('\n');
}
