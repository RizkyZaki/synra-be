import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AuditAction, IngestSource, MetricType, Prisma } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { PrismaService } from '../../prisma/prisma.service';
import { ElasticsearchService } from '../elasticsearch/elasticsearch.service';
import { AlertsEngineService } from '../alerts/alerts-engine.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';
import { paginate, PaginationQueryDto } from '../../common/dto/pagination.dto';
import { BACKUP_DATASET, BACKUP_FIELDS, normalizeBackupDoc } from '../backups/backup-rules';
import { METRICBEAT_FIELDS, NormalizedMetric, normalizeCsvRow, normalizeHostname, normalizeMetricbeatDoc } from './normalizer';

const PAGE_SIZE = 5000;
const INSERT_CHUNK = 5000;
const ERROR_LEVELS = ['error', 'ERROR', 'Error', 'err', 'ERR', 'critical', 'CRITICAL', 'crit', 'fatal', 'FATAL', 'emerg', 'EMERG'];
const CSV_MAX_ROWS = 50_000;
const BACKUP_PAGE = 5000;

interface SourceStats {
  docsRead: number;
  metricsSaved: number;
}

@Injectable()
export class IngestionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IngestionService.name);
  private running = false;
  private startupTimer?: NodeJS.Timeout;

  private readonly enabled: boolean;
  private readonly intervalMinutes: number;
  private readonly lookbackHours: number;
  private readonly overlapMs: number;
  private readonly maxDocs: number;
  private readonly metricbeatIndex: string;
  private readonly filebeatIndex: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly es: ElasticsearchService,
    private readonly engine: AlertsEngineService,
    private readonly audit: AuditService,
    private readonly scheduler: SchedulerRegistry,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('INGEST_ENABLED', true);
    this.intervalMinutes = config.get<number>('INGEST_INTERVAL_MINUTES', 5);
    this.lookbackHours = config.get<number>('INGEST_INITIAL_LOOKBACK_HOURS', 24);
    this.overlapMs = config.get<number>('INGEST_OVERLAP_SECONDS', 60) * 1000;
    this.maxDocs = config.get<number>('INGEST_MAX_DOCS_PER_RUN', 50_000);
    this.metricbeatIndex = config.get<string>('METRICBEAT_INDEX', 'metricbeat-*');
    this.filebeatIndex = config.get<string>('FILEBEAT_INDEX', 'filebeat-*');
  }

  onApplicationBootstrap() {
    if (!this.enabled) {
      this.logger.log('Ingestion terjadwal dinonaktifkan (INGEST_ENABLED=false).');
      return;
    }
    const tick = () => void this.run().catch((e) => this.logger.error(`Ingest gagal: ${(e as Error).message}`));
    this.scheduler.addInterval('ingestion', setInterval(tick, this.intervalMinutes * 60_000));
    // Run pertama sesaat setelah start agar data tidak menunggu satu interval penuh.
    this.startupTimer = setTimeout(tick, 5_000);
    this.logger.log(`Ingestion terjadwal setiap ${this.intervalMinutes} menit.`);
  }

  onModuleDestroy() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
  }

  async runManually() {
    if (this.running) throw new ConflictException(MSG.INGEST_RUNNING);
    return this.run();
  }

  /** Satu siklus: Metricbeat → Filebeat → evaluasi threshold. */
  async run() {
    if (this.running) {
      this.logger.warn('Ingest sebelumnya masih berjalan, siklus ini dilewati.');
      return null;
    }
    this.running = true;
    const run = await this.prisma.ingestionRun.create({ data: { source: IngestSource.ELASTICSEARCH, unknownHosts: [] } });
    const unknown = new Set<string>();
    const stats: SourceStats = { docsRead: 0, metricsSaved: 0 };
    let error: string | null = null;
    let evaluation: Awaited<ReturnType<AlertsEngineService['evaluate']>> | null = null;

    try {
      const hosts = await this.hostMap();
      const lastSeen = new Map<string, Date>();
      const mb = await this.ingestMetricbeat(hosts, unknown, lastSeen);
      const fb = await this.ingestFilebeat(hosts, unknown, lastSeen);
      const bk = await this.ingestBackups(hosts, unknown);
      stats.docsRead = mb.docsRead + fb.docsRead;
      stats.metricsSaved = mb.metricsSaved + fb.metricsSaved + bk;
      await this.updateLastSeen(lastSeen);
      // Evaluasi hanya bila ES berhasil dibaca; bila ES gagal, semua host akan tampak stale secara keliru.
      evaluation = await this.engine.evaluate();
    } catch (e) {
      error = describeEsError(e);
      this.logger.error(`Ingest gagal: ${error}`);
    } finally {
      this.running = false;
    }

    return this.prisma.ingestionRun
      .update({
        where: { id: run.id },
        data: { finishedAt: new Date(), ...stats, unknownHosts: [...unknown].sort(), error },
      })
      .then((r) => ({ ...r, evaluation }));
  }

  private async ingestMetricbeat(
    hosts: Map<string, string>,
    unknown: Set<string>,
    lastSeen: Map<string, Date>,
  ): Promise<SourceStats> {
    const windowEnd = new Date();
    const cursor = await this.cursor(this.metricbeatIndex);
    const from = new Date(cursor.getTime() - this.overlapMs);
    const stats: SourceStats = { docsRead: 0, metricsSaved: 0 };

    let pit: string;
    try {
      pit = (await this.es.client.openPointInTime({ index: this.metricbeatIndex, keep_alive: '2m', ignore_unavailable: true })).id;
    } catch (e) {
      if (isIndexMissing(e)) return stats;
      throw e;
    }

    let searchAfter: Prisma.InputJsonValue[] | undefined;
    let lastTs: Date | null = null;
    let truncated = false;
    try {
      while (true) {
        const res = await this.es.client.search({
          pit: { id: pit, keep_alive: '2m' },
          size: PAGE_SIZE,
          track_total_hits: false,
          _source: ['@timestamp', ...Object.values(METRICBEAT_FIELDS)],
          query: {
            bool: {
              filter: [
                { range: { '@timestamp': { gte: from.toISOString(), lte: windowEnd.toISOString() } } },
                { terms: { 'metricset.name': ['cpu', 'memory', 'filesystem', 'uptime'] } },
                { exists: { field: 'host.name' } },
              ],
            },
          },
          sort: [{ '@timestamp': 'asc' }, { _shard_doc: 'asc' }],
          ...(searchAfter ? { search_after: searchAfter as never } : {}),
        });
        pit = res.pit_id ?? pit;
        const hits = res.hits.hits;
        if (hits.length === 0) break;

        const rows: NormalizedMetric[] = hits.flatMap((h) => normalizeMetricbeatDoc(h._source));
        stats.docsRead += hits.length;
        stats.metricsSaved += await this.save(rows, hosts, unknown, lastSeen, IngestSource.ELASTICSEARCH);
        lastTs = rows.length ? rows[rows.length - 1].timestamp : lastTs;
        searchAfter = hits[hits.length - 1].sort as Prisma.InputJsonValue[];

        if (hits.length < PAGE_SIZE) break;
        if (stats.docsRead >= this.maxDocs) {
          truncated = true;
          break;
        }
      }
    } finally {
      await this.es.client.closePointInTime({ id: pit }).catch(() => undefined);
    }

    // Bila dibatasi INGEST_MAX_DOCS_PER_RUN, lanjutkan dari dokumen terakhir pada run berikutnya.
    const next = truncated && lastTs ? lastTs : windowEnd;
    await this.saveCursor(this.metricbeatIndex, next);
    if (truncated) this.logger.warn(`Metricbeat: batas ${this.maxDocs} dokumen tercapai, sisa diambil pada run berikutnya.`);
    return stats;
  }

  /**
   * Filebeat hanya dipakai untuk tanda "host hidup" dan jumlah log ERROR per run.
   * Isi pesan log tidak pernah dibaca maupun disimpan (bisa memuat data nasabah).
   */
  private async ingestFilebeat(
    hosts: Map<string, string>,
    unknown: Set<string>,
    lastSeen: Map<string, Date>,
  ): Promise<SourceStats> {
    const windowEnd = new Date();
    const from = await this.cursor(this.filebeatIndex);
    const stats: SourceStats = { docsRead: 0, metricsSaved: 0 };

    let res;
    try {
      res = await this.es.client.search({
        index: this.filebeatIndex,
        ignore_unavailable: true,
        allow_no_indices: true,
        size: 0,
        query: {
          bool: {
            filter: [
              { range: { '@timestamp': { gt: from.toISOString(), lte: windowEnd.toISOString() } } },
              { exists: { field: 'host.name' } },
            ],
          },
        },
        aggs: {
          hosts: {
            terms: { field: 'host.name', size: 2000 },
            aggs: {
              last_seen: { max: { field: '@timestamp' } },
              // Log hasil backup dihitung terpisah (alert backup), bukan sebagai log error aplikasi.
              errors: {
                filter: {
                  bool: {
                    filter: [{ terms: { 'log.level': ERROR_LEVELS } }],
                    must_not: [{ term: { 'event.dataset': BACKUP_DATASET } }],
                  },
                },
              },
            },
          },
        },
      });
    } catch (e) {
      if (isIndexMissing(e)) return stats;
      throw e;
    }

    type Bucket = { key: string; doc_count: number; last_seen: { value: number | null }; errors: { doc_count: number } };
    const buckets = ((res.aggregations?.hosts as { buckets?: Bucket[] })?.buckets ?? []);
    const rows: NormalizedMetric[] = [];
    for (const b of buckets) {
      const hostname = normalizeHostname(b.key);
      if (!hostname) continue;
      stats.docsRead += b.doc_count;
      if (b.last_seen.value) {
        const ts = new Date(b.last_seen.value);
        const assetId = hosts.get(hostname);
        if (assetId && (!lastSeen.has(assetId) || lastSeen.get(assetId)! < ts)) lastSeen.set(assetId, ts);
      }
      rows.push({ hostname, metric: MetricType.LOG_ERROR_COUNT, label: '', value: b.errors.doc_count, timestamp: windowEnd });
    }
    stats.metricsSaved += await this.save(rows, hosts, unknown, new Map(), IngestSource.ELASTICSEARCH);
    await this.saveCursor(this.filebeatIndex, windowEnd);
    return stats;
  }

  /**
   * Hasil backup: satu dokumen Filebeat per eksekusi job (event.dataset = "synra.backup").
   * Hanya field synra.backup.* yang dibaca. Mengembalikan jumlah hasil backup baru.
   */
  private async ingestBackups(hosts: Map<string, string>, unknown: Set<string>): Promise<number> {
    const key = `${this.filebeatIndex}#backup`;
    const windowEnd = new Date();
    const from = new Date((await this.cursor(key)).getTime() - this.overlapMs);
    let res;
    try {
      res = await this.es.client.search({
        index: this.filebeatIndex,
        ignore_unavailable: true,
        allow_no_indices: true,
        size: BACKUP_PAGE,
        _source: BACKUP_FIELDS,
        query: {
          bool: {
            filter: [
              { term: { 'event.dataset': BACKUP_DATASET } },
              { range: { '@timestamp': { gte: from.toISOString(), lte: windowEnd.toISOString() } } },
            ],
          },
        },
        sort: [{ '@timestamp': 'asc' }],
      });
    } catch (e) {
      if (isIndexMissing(e)) return 0;
      throw e;
    }

    const docs = res.hits.hits.map((h) => normalizeBackupDoc(h._source)).filter((d) => d !== null);
    const data: Prisma.BackupRunCreateManyInput[] = [];
    for (const d of docs) {
      const assetId = hosts.get(d.hostname);
      if (!assetId) {
        unknown.add(d.hostname);
        continue;
      }
      const { hostname: _h, ...run } = d;
      data.push({ assetId, ...run });
    }
    const inserted = data.length ? (await this.prisma.backupRun.createMany({ data, skipDuplicates: true })).count : 0;
    // Bila halaman penuh, lanjutkan dari dokumen terakhir pada run berikutnya.
    const full = res.hits.hits.length === BACKUP_PAGE && docs.length > 0;
    await this.saveCursor(key, full ? docs[docs.length - 1].finishedAt : windowEnd);
    return inserted;
  }

  // ---------------------------------------------------------------- CSV

  async importCsv(file: Express.Multer.File | undefined, actor: AuthUser, meta: RequestMeta) {
    if (!file) throw new BadRequestException(MSG.CSV_REQUIRED);
    let records: Record<string, string>[];
    try {
      records = parse(file.buffer, {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        bom: true,
        delimiter: [',', ';'],
      });
    } catch (e) {
      throw new BadRequestException(`${MSG.CSV_INVALID} ${(e as Error).message}`);
    }
    if (records.length === 0) throw new BadRequestException(`${MSG.CSV_INVALID} File tidak berisi data.`);
    if (records.length > CSV_MAX_ROWS) throw new BadRequestException(`${MSG.CSV_INVALID} Maksimal ${CSV_MAX_ROWS} baris.`);
    const missing = ['hostname', 'metric', 'value', 'timestamp'].filter((c) => !(c in records[0]));
    if (missing.length) throw new BadRequestException(`${MSG.CSV_INVALID} Kolom wajib tidak ada: ${missing.join(', ')}.`);

    const run = await this.prisma.ingestionRun.create({ data: { source: IngestSource.CSV, unknownHosts: [] } });
    const hosts = await this.hostMap();
    const errors: { row: number; message: string }[] = [];
    const valid: NormalizedMetric[] = [];
    records.forEach((r, i) => {
      const result = normalizeCsvRow(r);
      const rowNo = i + 2; // baris 1 = header
      if (!result.ok) errors.push({ row: rowNo, message: result.error });
      else if (!hosts.has(result.metric.hostname)) errors.push({ row: rowNo, message: `hostname "${result.metric.hostname}" belum terdaftar sebagai aset` });
      else valid.push(result.metric);
    });

    const lastSeen = new Map<string, Date>();
    const inserted = await this.save(valid, hosts, new Set(), lastSeen, IngestSource.CSV);
    await this.updateLastSeen(lastSeen);
    const evaluation = valid.length > 0 ? await this.engine.evaluate() : null;

    const summary = {
      fileName: file.originalname,
      totalRows: records.length,
      validRows: valid.length,
      inserted,
      duplicates: valid.length - inserted,
      invalidRows: errors.length,
    };
    await this.prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        docsRead: records.length,
        metricsSaved: inserted,
        error: errors.length ? `${errors.length} baris tidak valid` : null,
      },
    });
    await this.audit.log({
      action: AuditAction.METRIC_IMPORT,
      actorId: actor.id,
      actorUsername: actor.username,
      entity: 'IngestionRun',
      entityId: run.id,
      after: summary,
      meta,
    });
    return { ...summary, errors: errors.slice(0, 100), evaluation };
  }

  // ---------------------------------------------------------------- query

  async listRuns(q: PaginationQueryDto) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ingestionRun.findMany({ orderBy: { startedAt: 'desc' }, skip: q.skip, take: q.limit }),
      this.prisma.ingestionRun.count(),
    ]);
    return paginate(rows, total, q);
  }

  async status() {
    const [cursors, lastRun, esReachable] = await Promise.all([
      this.prisma.ingestionState.findMany(),
      this.prisma.ingestionRun.findFirst({ where: { source: IngestSource.ELASTICSEARCH }, orderBy: { startedAt: 'desc' } }),
      this.es.ping(),
    ]);
    return {
      enabled: this.enabled,
      intervalMinutes: this.intervalMinutes,
      running: this.running,
      esReachable,
      indices: { metricbeat: this.metricbeatIndex, filebeat: this.filebeatIndex },
      cursors,
      lastRun,
    };
  }

  // ---------------------------------------------------------------- helpers

  /** hostname → assetId untuk aset aktif. */
  private async hostMap(): Promise<Map<string, string>> {
    const assets = await this.prisma.asset.findMany({ where: { isActive: true }, select: { id: true, hostname: true } });
    return new Map(assets.map((a) => [a.hostname, a.id]));
  }

  /** Menyimpan metrik (idempoten lewat unique constraint). Mengembalikan jumlah baris baru. */
  private async save(
    rows: NormalizedMetric[],
    hosts: Map<string, string>,
    unknown: Set<string>,
    lastSeen: Map<string, Date>,
    source: IngestSource,
  ): Promise<number> {
    const data: Prisma.MetricCreateManyInput[] = [];
    for (const r of rows) {
      const assetId = hosts.get(r.hostname);
      if (!assetId) {
        unknown.add(r.hostname);
        continue;
      }
      data.push({ assetId, metric: r.metric, label: r.label, value: r.value, timestamp: r.timestamp, source });
      if (r.metric !== MetricType.LOG_ERROR_COUNT && (!lastSeen.has(assetId) || lastSeen.get(assetId)! < r.timestamp)) {
        lastSeen.set(assetId, r.timestamp);
      }
    }
    let inserted = 0;
    for (let i = 0; i < data.length; i += INSERT_CHUNK) {
      inserted += (await this.prisma.metric.createMany({ data: data.slice(i, i + INSERT_CHUNK), skipDuplicates: true })).count;
    }
    return inserted;
  }

  private async updateLastSeen(lastSeen: Map<string, Date>) {
    for (const [id, ts] of lastSeen) {
      await this.prisma.asset.updateMany({
        where: { id, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: ts } }] },
        data: { lastSeenAt: ts },
      });
    }
  }

  private async cursor(index: string): Promise<Date> {
    const state = await this.prisma.ingestionState.findUnique({ where: { id: index } });
    return state?.lastTimestamp ?? new Date(Date.now() - this.lookbackHours * 3600_000);
  }

  private saveCursor(index: string, ts: Date) {
    return this.prisma.ingestionState.upsert({
      where: { id: index },
      create: { id: index, lastTimestamp: ts },
      update: { lastTimestamp: ts },
    });
  }
}

function isIndexMissing(e: unknown): boolean {
  const err = e as { meta?: { statusCode?: number; body?: { error?: { type?: string } } } };
  return err.meta?.statusCode === 404 || err.meta?.body?.error?.type === 'index_not_found_exception';
}

function describeEsError(e: unknown): string {
  const err = e as { name?: string; message?: string };
  if (err.name === 'ConnectionError' || err.name === 'TimeoutError') return `${MSG.ES_UNAVAILABLE} (${err.message})`;
  return err.message ?? String(e);
}
