/**
 * Simulator Metricbeat/Filebeat untuk Elasticsearch LOKAL.
 *
 *   npm run simulate                       # backfill 24 jam lalu kirim data live tiap 10 detik
 *   npm run simulate -- --hours=6          # backfill 6 jam
 *   npm run simulate -- --no-live          # backfill saja lalu keluar
 *   npm run simulate -- --reset            # hapus index simulasi dulu
 *
 * Menolak jalan bila alamat Elasticsearch bukan lokal (localhost/elasticsearch), kecuali --force.
 *
 * Juga mengirim log hasil backup (event.dataset = "synra.backup") ke index filebeat-sim-*.
 *
 * Menulis ke index metricbeat-sim-YYYY.MM.DD dan filebeat-sim-YYYY.MM.DD (cocok dengan pola
 * metricbeat-* / filebeat-* yang dibaca backend). Jangan arahkan ke Elasticsearch produksi.
 */
import 'dotenv/config';
import { Client } from '@elastic/elasticsearch';
import { SIM_ASSETS, SimAsset, isSending } from './sim-hosts';
import { backupRunsBetween } from './sim-backup';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'] as const;
  }),
);
const HOURS = Number(args.get('hours') ?? 24);
const LIVE = args.get('no-live') !== 'true';
const RESET = args.get('reset') === 'true';
const BACKFILL_STEP_SEC = 60;
const LIVE_STEP_SEC = Number(args.get('interval') ?? 10);
const NODE = process.env.SIM_ELASTICSEARCH_NODE ?? process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200';
const FORCE = args.get('force') === 'true';
/** Simulator menulis data palsu; hanya Elasticsearch lokal (atau container compose) yang diizinkan. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', 'elasticsearch'];

function nodeHost(): string {
  try {
    return new URL(NODE).hostname;
  } catch {
    return '';
  }
}

if (!LOCAL_HOSTS.includes(nodeHost()) && !FORCE) {
  console.error(`Simulator dibatalkan: Elasticsearch "${NODE}" bukan lokal. Simulator menulis data palsu dan tidak boleh diarahkan ke Elasticsearch kantor/produksi.`);
  console.error('Isi SIM_ELASTICSEARCH_NODE=http://localhost:9200, atau tambahkan --force bila memang disengaja.');
  process.exit(1);
}

const es = new Client({ node: NODE });

// ------------------------------------------------------------------ nilai metrik

/** Nilai deterministik-acak yang halus terhadap waktu (gelombang harian + noise). */
function wave(host: SimAsset, key: string, t: number, base: number, amp: number): number {
  const seed = [...(host.hostname + key)].reduce((s, c) => s + c.charCodeAt(0), 0);
  const daily = Math.sin((t / 86_400_000) * 2 * Math.PI + seed) * amp;
  const noise = (Math.sin(t / 97_000 + seed * 3) + Math.sin(t / 31_000 + seed)) * (amp / 4);
  return base + daily + noise;
}

const clampPct = (v: number) => Math.min(Math.max(v, 0.5), 99.9) / 100;

function cpu(host: SimAsset, t: number): number {
  if (host.scenario === 'cpu-high') {
    // Normal sampai 90 menit terakhir, lalu melonjak ke 85–95%.
    return clampPct(Date.now() - t < 90 * 60_000 ? wave(host, 'cpu', t, 90, 4) : wave(host, 'cpu', t, 45, 15));
  }
  return clampPct(wave(host, 'cpu', t, 35, 15));
}

function memory(host: SimAsset, t: number): number {
  if (host.scenario === 'memory-high') {
    return clampPct(Date.now() - t < 60 * 60_000 ? wave(host, 'mem', t, 91, 2) : wave(host, 'mem', t, 70, 6));
  }
  return clampPct(wave(host, 'mem', t, 60, 10));
}

function disk(host: SimAsset, mount: string, t: number): number {
  const hoursAgo = (Date.now() - t) / 3_600_000;
  if (host.scenario === 'disk-full' && mount === '/data') return clampPct(96.5 - hoursAgo * 0.3); // tumbuh menuju penuh
  if (host.scenario === 'disk-warning' && mount === '/') return clampPct(82 - hoursAgo * 0.05);
  return clampPct((mount === '/' ? 42 : 58) + wave(host, `disk${mount}`, t, 0, 1));
}

// ------------------------------------------------------------------ dokumen

const day = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '.');
const BOOT_AT = Date.now() - 37 * 86_400_000;

function metricbeatDocs(host: SimAsset, t: number): object[] {
  const base = {
    '@timestamp': new Date(t).toISOString(),
    host: { name: host.hostname, ip: [host.ip] },
    agent: { type: 'metricbeat', version: '8.15.3' },
    event: { module: 'system' },
  };
  return [
    { ...base, metricset: { name: 'cpu' }, event: { ...base.event, dataset: 'system.cpu' }, system: { cpu: { total: { norm: { pct: cpu(host, t) } } } } },
    { ...base, metricset: { name: 'memory' }, event: { ...base.event, dataset: 'system.memory' }, system: { memory: { actual: { used: { pct: memory(host, t) } } } } },
    { ...base, metricset: { name: 'uptime' }, event: { ...base.event, dataset: 'system.uptime' }, system: { uptime: { duration: { ms: t - BOOT_AT } } } },
    ...host.mounts.map((m) => ({
      ...base,
      metricset: { name: 'filesystem' },
      event: { ...base.event, dataset: 'system.filesystem' },
      system: { filesystem: { mount_point: m, used: { pct: disk(host, m, t) } } },
    })),
  ];
}

/** Log sintetis tanpa data nasabah. host error-logs menghasilkan banyak log ERROR. */
function filebeatDocs(host: SimAsset, t: number): object[] {
  const errorRate = host.scenario === 'error-logs' ? 0.6 : 0.03;
  const docs = [{ level: 'info', message: 'Service heartbeat OK' }];
  if (Math.random() < errorRate) docs.push({ level: 'error', message: 'Connection pool timeout ke service internal' });
  if (Math.random() < 0.1) docs.push({ level: 'warn', message: 'Response time di atas baseline' });
  return docs.map((d) => ({
    '@timestamp': new Date(t).toISOString(),
    host: { name: host.hostname },
    agent: { type: 'filebeat', version: '8.15.3' },
    event: { dataset: 'system.syslog' },
    log: { level: d.level },
    message: d.message,
  }));
}

// ------------------------------------------------------------------ backup

/** Dokumen Filebeat (dataset synra.backup) untuk semua jadwal job yang jatuh di (from, to]. */
function backupDocsBetween(from: number, to: number) {
  return backupRunsBetween(from, to).map(({ host, run }) => {
    const failed = run.status === 'FAILED';
    return {
      index: `filebeat-sim-${day(run.finishedAt.getTime())}`,
      doc: {
        '@timestamp': run.finishedAt.toISOString(),
        host: { name: host.hostname },
        agent: { type: 'filebeat', version: '8.15.3' },
        event: { dataset: 'synra.backup' },
        log: { level: failed ? 'error' : 'info' },
        message: `backup ${run.jobName} ${run.status}`,
        synra: {
          backup: {
            job: run.jobName,
            type: run.type,
            status: failed ? 'failed' : 'success',
            started_at: run.startedAt.toISOString(),
            size_bytes: run.sizeBytes,
            duration_s: run.durationSec,
            target: run.target,
            ...(run.message ? { message: run.message } : {}),
          },
        },
      },
    };
  });
}

// ------------------------------------------------------------------ ES

async function ensureTemplates() {
  const common = {
    '@timestamp': { type: 'date' },
    host: { properties: { name: { type: 'keyword' }, ip: { type: 'ip' } } },
    agent: { properties: { type: { type: 'keyword' }, version: { type: 'keyword' } } },
    event: { properties: { module: { type: 'keyword' }, dataset: { type: 'keyword' } } },
  } as const;
  await es.indices.putIndexTemplate({
    name: 'synra-sim-metricbeat',
    index_patterns: ['metricbeat-sim-*'],
    template: {
      settings: { number_of_replicas: 0 },
      mappings: {
        properties: {
          ...common,
          metricset: { properties: { name: { type: 'keyword' } } },
          system: {
            properties: {
              cpu: { properties: { total: { properties: { norm: { properties: { pct: { type: 'float' } } } } } } },
              memory: { properties: { actual: { properties: { used: { properties: { pct: { type: 'float' } } } } } } },
              filesystem: { properties: { mount_point: { type: 'keyword' }, used: { properties: { pct: { type: 'float' } } } } },
              uptime: { properties: { duration: { properties: { ms: { type: 'long' } } } } },
            },
          },
        },
      },
    },
  });
  await es.indices.putIndexTemplate({
    name: 'synra-sim-filebeat',
    index_patterns: ['filebeat-sim-*'],
    template: {
      settings: { number_of_replicas: 0 },
      mappings: {
        properties: {
          ...common,
          log: { properties: { level: { type: 'keyword' } } },
          message: { type: 'text' },
          synra: {
            properties: {
              backup: {
                properties: {
                  job: { type: 'keyword' },
                  type: { type: 'keyword' },
                  status: { type: 'keyword' },
                  started_at: { type: 'date' },
                  size_bytes: { type: 'long' },
                  duration_s: { type: 'long' },
                  target: { type: 'keyword' },
                  message: { type: 'keyword' },
                },
              },
            },
          },
        },
      },
    },
  });
}

async function bulk(docs: { index: string; doc: object }[]) {
  for (let i = 0; i < docs.length; i += 5000) {
    const chunk = docs.slice(i, i + 5000);
    const res = await es.bulk({ operations: chunk.flatMap((d) => [{ index: { _index: d.index } }, d.doc]) });
    if (res.errors) {
      const first = res.items.find((it) => it.index?.error)?.index?.error;
      throw new Error(`Bulk gagal: ${JSON.stringify(first)}`);
    }
  }
}

function docsAt(t: number) {
  return SIM_ASSETS.filter((h) => isSending(h, t)).flatMap((h) => [
    ...metricbeatDocs(h, t).map((doc) => ({ index: `metricbeat-sim-${day(t)}`, doc })),
    ...filebeatDocs(h, t).map((doc) => ({ index: `filebeat-sim-${day(t)}`, doc })),
  ]);
}

async function main() {
  console.log(`Simulator SYNRA → ${NODE}`);
  try {
    await es.ping();
  } catch {
    console.error(`Elasticsearch tidak dapat dihubungi di ${NODE}. Jalankan: docker compose up -d elasticsearch`);
    process.exit(1);
  }

  if (RESET) {
    // ES 8 menolak delete dengan wildcard (action.destructive_requires_name), jadi nama index dicari dulu.
    const existing = Object.keys(
      await es.indices.get({ index: 'metricbeat-sim-*,filebeat-sim-*', ignore_unavailable: true, allow_no_indices: true }),
    );
    if (existing.length) await es.indices.delete({ index: existing });
    console.log(`- ${existing.length} index simulasi dihapus.`);
  }
  await ensureTemplates();

  const now = Date.now();
  const start = now - HOURS * 3_600_000;
  let total = 0;
  let batch: { index: string; doc: object }[] = [];
  for (let t = start; t <= now; t += BACKFILL_STEP_SEC * 1000) {
    batch.push(...docsAt(t));
    if (batch.length >= 20_000) {
      await bulk(batch);
      total += batch.length;
      batch = [];
      process.stdout.write(`\r- Backfill ${HOURS} jam: ${total} dokumen`);
    }
  }
  batch.push(...backupDocsBetween(start, now));
  await bulk(batch);
  total += batch.length;
  await es.indices.refresh({ index: 'metricbeat-sim-*,filebeat-sim-*', ignore_unavailable: true });
  console.log(`\r- Backfill ${HOURS} jam selesai: ${total} dokumen.`);
  console.log('- Skenario: ' + SIM_ASSETS.map((h) => `${h.hostname}=${h.scenario}${h.unregistered ? ' (tidak terdaftar)' : ''}`).join(', '));
  console.log('- Backup: ' + SIM_ASSETS.filter((h) => h.backup).map((h) => `${h.hostname}=${h.backup}`).join(', ') + ', lainnya berhasil.');

  if (!LIVE) return;
  console.log(`- Mode live: kirim data tiap ${LIVE_STEP_SEC} detik. Tekan Ctrl+C untuk berhenti.`);
  let lastTick = now;
  const tick = async () => {
    try {
      const t = Date.now();
      const docs = [...docsAt(t), ...backupDocsBetween(lastTick, t)];
      lastTick = t;
      await bulk(docs);
      process.stdout.write(`\r- Live: ${new Date().toLocaleTimeString('id-ID')} +${docs.length} dokumen   `);
    } catch (e) {
      console.error(`\nGagal kirim: ${(e as Error).message}`);
    }
  };
  setInterval(() => void tick(), LIVE_STEP_SEC * 1000);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
