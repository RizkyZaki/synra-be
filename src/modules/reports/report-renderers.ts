import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import type { DailyReport } from './reports.service';

const fmtTime = (d: Date | null, tz: string) =>
  d ? d.toLocaleString('id-ID', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }) : '-';
const fmtNum = (n: number | null) => (n === null ? '-' : n.toLocaleString('id-ID', { maximumFractionDigits: 2 }));

const STATUS_LABEL: Record<string, string> = {
  NEW: 'Baru',
  ACKNOWLEDGED: 'Diakui',
  IN_PROGRESS: 'Dalam penanganan',
  PENDING_REVIEW: 'Menunggu review',
  CLOSED: 'Ditutup',
};

function scopeText(r: DailyReport): string {
  return `Host: ${r.scope.host ?? 'Semua'} · Komponen: ${r.scope.component ?? 'Semua'}`;
}

export async function renderXlsx(r: DailyReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SYNRA';
  wb.created = r.generatedAt;

  const summary = wb.addWorksheet('Ringkasan');
  summary.columns = [{ width: 32 }, { width: 40 }];
  summary.addRows([
    ['Laporan Harian SYNRA', ''],
    ['Tanggal', r.date],
    ['Zona waktu', r.timezone],
    ['Cakupan', scopeText(r)],
    ['Dibuat', fmtTime(r.generatedAt, r.timezone)],
    [],
    ['Total aset', r.summary.totalAssets],
    ['Rata-rata availability (%)', r.summary.availabilityAvgPct ?? '-'],
    ['Alert terdeteksi', r.summary.alertsDetected],
    ['Alert ditutup', r.summary.alertsClosed],
    ...Object.entries(r.summary.detectedBySeverity).map(([s, n]) => [`Alert ${s}`, n]),
  ]);
  summary.getRow(1).font = { bold: true, size: 14 };

  const assets = wb.addWorksheet('Aset');
  assets.columns = [
    { header: 'Hostname', key: 'hostname', width: 26 },
    { header: 'IP', key: 'ipAddress', width: 16 },
    { header: 'Host', key: 'host', width: 22 },
    { header: 'Komponen', key: 'component', width: 16 },
    { header: 'PIC', key: 'picName', width: 22 },
    { header: 'CPU rata-rata (%)', key: 'cpuAvg', width: 16 },
    { header: 'CPU maks (%)', key: 'cpuMax', width: 14 },
    { header: 'Memori rata-rata (%)', key: 'memoryAvg', width: 18 },
    { header: 'Memori maks (%)', key: 'memoryMax', width: 16 },
    { header: 'Disk maks (%)', key: 'diskMax', width: 14 },
    { header: 'Availability (%)', key: 'availabilityPct', width: 16 },
    { header: 'Alert', key: 'alertsDetected', width: 8 },
  ];
  assets.addRows(r.assets);
  assets.getRow(1).font = { bold: true };
  assets.views = [{ state: 'frozen', ySplit: 1 }];

  const alerts = wb.addWorksheet('Alert');
  alerts.columns = [
    { header: 'ID', key: 'code', width: 10 },
    { header: 'Hostname', key: 'hostname', width: 26 },
    { header: 'Host', key: 'host', width: 22 },
    { header: 'Masalah', key: 'problem', width: 50 },
    { header: 'Severity', key: 'severity', width: 11 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Terdeteksi', key: 'detectedAt', width: 18 },
    { header: 'Ditutup', key: 'closedAt', width: 18 },
    { header: 'Catatan penutupan', key: 'closeNote', width: 40 },
  ];
  alerts.addRows(
    r.alerts.map((a) => ({
      ...a,
      status: STATUS_LABEL[a.status] ?? a.status,
      detectedAt: fmtTime(a.detectedAt, r.timezone),
      closedAt: fmtTime(a.closedAt, r.timezone),
      closeNote: a.closeNote ?? '',
    })),
  );
  alerts.getRow(1).font = { bold: true };
  alerts.views = [{ state: 'frozen', ySplit: 1 }];

  return Buffer.from(await wb.xlsx.writeBuffer());
}

interface Column {
  header: string;
  width: number;
  value: (row: never) => string;
}

export function renderPdf(r: DailyReport): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, info: { Title: `Laporan Harian SYNRA ${r.date}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.font('Helvetica-Bold').fontSize(16).text('Laporan Harian SYNRA');
    doc.font('Helvetica').fontSize(9).fillColor('#555')
      .text(`Tanggal ${r.date} (${r.timezone}) · ${scopeText(r)} · Dibuat ${fmtTime(r.generatedAt, r.timezone)}`);
    doc.moveDown(0.8).fillColor('#000');

    const s = r.summary;
    doc.font('Helvetica-Bold').fontSize(11).text('Ringkasan');
    doc.font('Helvetica').fontSize(9).text(
      `Total aset: ${s.totalAssets}   ·   Rata-rata availability: ${fmtNum(s.availabilityAvgPct)}%   ·   ` +
        `Alert terdeteksi: ${s.alertsDetected}   ·   Alert ditutup: ${s.alertsClosed}`,
    );
    doc.text(
      'Per severity: ' +
        Object.entries(s.detectedBySeverity)
          .map(([k, v]) => `${k} ${v}`)
          .join(', '),
    );
    doc.moveDown(0.8);

    table(doc, 'Aset', r.assets, [
      { header: 'Hostname', width: 130, value: (a: DailyReport['assets'][number]) => a.hostname },
      { header: 'Host', width: 110, value: (a: DailyReport['assets'][number]) => a.host },
      { header: 'Komponen', width: 85, value: (a: DailyReport['assets'][number]) => a.component },
      { header: 'CPU avg/maks', width: 75, value: (a: DailyReport['assets'][number]) => `${fmtNum(a.cpuAvg)} / ${fmtNum(a.cpuMax)}` },
      { header: 'Memori avg/maks', width: 85, value: (a: DailyReport['assets'][number]) => `${fmtNum(a.memoryAvg)} / ${fmtNum(a.memoryMax)}` },
      { header: 'Disk maks', width: 55, value: (a: DailyReport['assets'][number]) => fmtNum(a.diskMax) },
      { header: 'Availability', width: 65, value: (a: DailyReport['assets'][number]) => (a.availabilityPct === null ? '-' : `${fmtNum(a.availabilityPct)}%`) },
      { header: 'Alert', width: 40, value: (a: DailyReport['assets'][number]) => String(a.alertsDetected) },
    ] as Column[]);

    doc.moveDown(0.8);
    table(doc, 'Alert terdeteksi', r.alerts, [
      { header: 'ID', width: 50, value: (a: DailyReport['alerts'][number]) => a.code },
      { header: 'Hostname', width: 115, value: (a: DailyReport['alerts'][number]) => a.hostname },
      { header: 'Masalah', width: 250, value: (a: DailyReport['alerts'][number]) => a.problem },
      { header: 'Severity', width: 60, value: (a: DailyReport['alerts'][number]) => a.severity },
      { header: 'Status', width: 90, value: (a: DailyReport['alerts'][number]) => STATUS_LABEL[a.status] ?? a.status },
      { header: 'Terdeteksi', width: 85, value: (a: DailyReport['alerts'][number]) => fmtTime(a.detectedAt, r.timezone) },
    ] as Column[]);

    doc.end();
  });
}

function table(doc: PDFKit.PDFDocument, title: string, rows: unknown[], cols: Column[]) {
  const left = doc.page.margins.left;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  doc.font('Helvetica-Bold').fontSize(11).text(title, left);
  doc.moveDown(0.3);
  if (rows.length === 0) {
    doc.font('Helvetica').fontSize(9).text('Tidak ada data.', left);
    return;
  }

  const drawRow = (cells: string[], bold: boolean) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    const height = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: cols[i].width - 6 }))) + 6;
    if (doc.y + height > bottom()) {
      doc.addPage();
      if (!bold) drawRow(cols.map((c) => c.header), true);
    }
    const y = doc.y;
    let x = left;
    cells.forEach((c, i) => {
      doc.text(c, x + 3, y + 3, { width: cols[i].width - 6 });
      x += cols[i].width;
    });
    doc.moveTo(left, y + height).lineTo(x, y + height).strokeColor('#ddd').lineWidth(0.5).stroke();
    doc.x = left;
    doc.y = y + height;
  };

  drawRow(cols.map((c) => c.header), true);
  for (const row of rows) drawRow(cols.map((c) => c.value(row as never)), false);
}
