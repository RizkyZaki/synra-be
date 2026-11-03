import { MetricType } from '@prisma/client';
import { fractionToPercent, normalizeCsvRow, normalizeMetricbeatDoc, pick } from './normalizer';

const ts = '2026-11-02T08:00:00.000Z';

describe('normalisasi Metricbeat', () => {
  it('CPU: system.cpu.total.norm.pct (0–1) menjadi persen', () => {
    const rows = normalizeMetricbeatDoc({
      '@timestamp': ts,
      host: { name: 'CBS-APP-01 ' },
      system: { cpu: { total: { norm: { pct: 0.8567 } } } },
    });
    expect(rows).toEqual([{ hostname: 'cbs-app-01', metric: MetricType.CPU, label: '', value: 85.67, timestamp: new Date(ts) }]);
  });

  it('memori: system.memory.actual.used.pct', () => {
    const [row] = normalizeMetricbeatDoc({ '@timestamp': ts, host: { name: 'h1' }, system: { memory: { actual: { used: { pct: 0.42 } } } } });
    expect(row).toMatchObject({ metric: MetricType.MEMORY, value: 42 });
  });

  it('disk: system.filesystem.used.pct dengan mount point sebagai label', () => {
    const [row] = normalizeMetricbeatDoc({
      '@timestamp': ts,
      host: { name: 'h1' },
      system: { filesystem: { mount_point: '/data', used: { pct: 0.9312 } } },
    });
    expect(row).toMatchObject({ metric: MetricType.DISK, label: '/data', value: 93.12 });
  });

  it('disk tanpa mount point memakai "/"', () => {
    const [row] = normalizeMetricbeatDoc({ '@timestamp': ts, host: { name: 'h1' }, system: { filesystem: { used: { pct: 0.5 } } } });
    expect(row.label).toBe('/');
  });

  it('uptime: system.uptime.duration.ms disimpan dalam milidetik', () => {
    const [row] = normalizeMetricbeatDoc({ '@timestamp': ts, host: { name: 'h1' }, system: { uptime: { duration: { ms: 123456.7 } } } });
    expect(row).toMatchObject({ metric: MetricType.UPTIME, value: 123457 });
  });

  it('mendukung field datar (dotted keys) maupun campuran', () => {
    const rows = normalizeMetricbeatDoc({
      '@timestamp': ts,
      'host.name': 'h1',
      'system.cpu.total.norm.pct': 0.1,
      system: { 'memory.actual.used.pct': 0.2 },
    });
    expect(rows.map((r) => [r.metric, r.value])).toEqual([
      [MetricType.CPU, 10],
      [MetricType.MEMORY, 20],
    ]);
  });

  it('membatasi persen ke 0–100', () => {
    expect(fractionToPercent(1.2)).toBe(100);
    expect(fractionToPercent(-0.1)).toBe(0);
  });

  it.each([
    ['tanpa host.name', { '@timestamp': ts, system: { cpu: { total: { norm: { pct: 0.5 } } } } }],
    ['timestamp tidak valid', { '@timestamp': 'bukan-tanggal', host: { name: 'h1' }, system: { cpu: { total: { norm: { pct: 0.5 } } } } }],
    ['nilai bukan angka', { '@timestamp': ts, host: { name: 'h1' }, system: { cpu: { total: { norm: { pct: 'abc' } } } } }],
    ['dokumen null', null],
  ])('mengabaikan dokumen %s', (_name, doc) => {
    expect(normalizeMetricbeatDoc(doc)).toEqual([]);
  });

  it('pick membaca path bersarang dan datar', () => {
    expect(pick({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
    expect(pick({ 'a.b': { c: 2 } }, 'a.b.c')).toBe(2);
    expect(pick({ a: { 'b.c': 3 } }, 'a.b.c')).toBe(3);
    expect(pick({ a: 1 }, 'a.b')).toBeUndefined();
  });
});

describe('normalisasi CSV', () => {
  // Harus di masa lalu: baris bertimestamp masa depan ditolak.
  const ts = '2020-01-01T08:00:00.000Z';
  const row = (over: Record<string, string> = {}) => ({ hostname: 'cbs-app-01', metric: 'cpu', value: '85.5', timestamp: ts, ...over });

  it('menerima baris valid (nilai dalam persen)', () => {
    expect(normalizeCsvRow(row())).toEqual({
      ok: true,
      metric: { hostname: 'cbs-app-01', metric: MetricType.CPU, label: '', value: 85.5, timestamp: new Date(ts) },
    });
  });

  it('menerima nama metrik Metricbeat dan desimal koma', () => {
    const r = normalizeCsvRow(row({ metric: 'system.filesystem.used.pct', value: '91,2', label: '/data' }));
    expect(r).toMatchObject({ ok: true, metric: { metric: MetricType.DISK, label: '/data', value: 91.2 } });
  });

  it('label diabaikan untuk metrik non-disk dan default "/" untuk disk', () => {
    expect(normalizeCsvRow(row({ label: '/x' }))).toMatchObject({ metric: { label: '' } });
    expect(normalizeCsvRow(row({ metric: 'disk' }))).toMatchObject({ metric: { label: '/' } });
  });

  it.each([
    [{ hostname: '' }, 'hostname wajib'],
    [{ metric: 'suhu' }, 'tidak dikenal'],
    [{ value: 'abc' }, 'harus berupa angka'],
    [{ value: '150' }, '0–100'],
    [{ metric: 'uptime', value: '-1' }, 'negatif'],
    [{ timestamp: 'kemarin' }, 'ISO 8601'],
    [{ timestamp: '2099-01-01T00:00:00Z' }, 'masa depan'],
  ])('menolak %p', (over, message) => {
    const r = normalizeCsvRow(row(over));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(message);
  });
});
