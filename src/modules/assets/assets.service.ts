import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AlertStatus, Asset, AuditAction, Bpd, Prisma, Severity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MetricsRepository, LatestSnapshot } from '../metrics/metrics.repository';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';
import { paginate } from '../../common/dto/pagination.dto';
import { ScopeFilterDto, assetScope } from '../../common/dto/scope-filter.dto';
import { CreateAssetDto, ListAssetsQueryDto, UpdateAssetDto } from './dto/asset.dto';
import { AssetStatus, deriveAssetStatus, maxSeverity } from './asset-status';

type AssetWithBpd = Asset & { bpd: Bpd };

export interface AssetView {
  id: string;
  hostname: string;
  ipAddress: string;
  component: string;
  bpd: { id: string; code: string; name: string };
  picName: string;
  picContact: string | null;
  notes: string | null;
  isActive: boolean;
  isStale: boolean;
  lastSeenAt: Date | null;
  status: AssetStatus;
  latest: LatestSnapshot;
  /** count = semua alert belum CLOSED; maxSeverity hanya dari alert yang kondisinya masih aktif */
  openAlerts: { count: number; activeCount: number; maxSeverity: Severity | null };
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly metrics: MetricsRepository,
  ) {}

  async list(q: ListAssetsQueryDto) {
    const where: Prisma.AssetWhereInput = {
      ...assetScope(q),
      ...(q.search
        ? {
            OR: [
              { hostname: { contains: q.search, mode: 'insensitive' } },
              { ipAddress: { contains: q.search } },
              { picName: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    // Status adalah nilai turunan, jadi filter status dilakukan setelah view dihitung.
    // Jumlah aset per instalasi kecil (puluhan–ratusan), sehingga aman dihitung di memori.
    let views = await this.views(where);
    if (q.status) views = views.filter((v) => v.status === q.status);
    return paginate(views.slice(q.skip, q.skip + q.limit), views.length, q);
  }

  /** Seluruh aset dalam scope (tanpa paginasi) — dipakai dashboard. */
  listAll(scope: ScopeFilterDto): Promise<AssetView[]> {
    return this.views(assetScope(scope));
  }

  async get(id: string): Promise<AssetView> {
    const [view] = await this.views({ id });
    if (!view) throw new NotFoundException(MSG.ASSET_NOT_FOUND);
    return view;
  }

  async components(): Promise<string[]> {
    const rows = await this.prisma.asset.findMany({
      distinct: ['component'],
      select: { component: true },
      orderBy: { component: 'asc' },
    });
    return rows.map((r) => r.component);
  }

  async create(dto: CreateAssetDto, actor: AuthUser, meta: RequestMeta): Promise<AssetView> {
    await this.ensureBpd(dto.bpdId);
    await this.ensureHostnameFree(dto.hostname);
    const asset = await this.prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({ data: dto });
      await this.audit.log(
        { action: AuditAction.ASSET_CREATE, actorId: actor.id, actorUsername: actor.username, entity: 'Asset', entityId: created.id, after: snapshot(created), meta },
        tx,
      );
      return created;
    });
    return this.get(asset.id);
  }

  async update(id: string, dto: UpdateAssetDto, actor: AuthUser, meta: RequestMeta): Promise<AssetView> {
    const before = await this.findOrFail(id);
    if (dto.bpdId) await this.ensureBpd(dto.bpdId);
    if (dto.hostname && dto.hostname !== before.hostname) await this.ensureHostnameFree(dto.hostname);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.asset.update({ where: { id }, data: dto });
      await this.audit.log(
        { action: AuditAction.ASSET_UPDATE, actorId: actor.id, actorUsername: actor.username, entity: 'Asset', entityId: id, before: snapshot(before), after: snapshot(updated), meta },
        tx,
      );
    });
    return this.get(id);
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta): Promise<void> {
    const before = await this.findOrFail(id);
    if ((await this.prisma.alert.count({ where: { assetId: id } })) > 0) {
      throw new ConflictException(MSG.ASSET_HAS_ALERTS);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.delete({ where: { id } });
      await this.audit.log(
        { action: AuditAction.ASSET_DELETE, actorId: actor.id, actorUsername: actor.username, entity: 'Asset', entityId: id, before: snapshot(before), meta },
        tx,
      );
    });
  }

  private async views(where: Prisma.AssetWhereInput): Promise<AssetView[]> {
    const assets: AssetWithBpd[] = await this.prisma.asset.findMany({
      where,
      include: { bpd: true },
      orderBy: [{ bpd: { name: 'asc' } }, { hostname: 'asc' }],
    });
    const ids = assets.map((a) => a.id);
    const [snapshots, openAlerts] = await Promise.all([
      this.metrics.latestSnapshots(ids),
      this.prisma.alert.findMany({
        where: { assetId: { in: ids }, status: { not: AlertStatus.CLOSED } },
        select: { assetId: true, severity: true, conditionActive: true },
      }),
    ]);
    const alertsByAsset = new Map<string, { severity: Severity; conditionActive: boolean }[]>();
    for (const a of openAlerts) {
      alertsByAsset.set(a.assetId, [...(alertsByAsset.get(a.assetId) ?? []), a]);
    }
    return assets.map((a) => {
      const open = alertsByAsset.get(a.id) ?? [];
      const active = open.filter((x) => x.conditionActive).map((x) => x.severity);
      // Status mencerminkan kondisi saat ini: alert yang sudah pulih tidak membuat aset tetap merah.
      const max = maxSeverity(active);
      return {
        id: a.id,
        hostname: a.hostname,
        ipAddress: a.ipAddress,
        component: a.component,
        bpd: { id: a.bpd.id, code: a.bpd.code, name: a.bpd.name },
        picName: a.picName,
        picContact: a.picContact,
        notes: a.notes,
        isActive: a.isActive,
        isStale: a.isStale,
        lastSeenAt: a.lastSeenAt,
        status: deriveAssetStatus({ isActive: a.isActive, isStale: a.isStale, openAlertMaxSeverity: max }),
        latest: snapshots.get(a.id)!,
        openAlerts: { count: open.length, activeCount: active.length, maxSeverity: max },
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      };
    });
  }

  private async findOrFail(id: string): Promise<Asset> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException(MSG.ASSET_NOT_FOUND);
    return asset;
  }

  private async ensureBpd(bpdId: string) {
    if (!(await this.prisma.bpd.findUnique({ where: { id: bpdId } }))) {
      throw new NotFoundException(MSG.BPD_NOT_FOUND);
    }
  }

  private async ensureHostnameFree(hostname: string) {
    if (await this.prisma.asset.findUnique({ where: { hostname } })) {
      throw new ConflictException(MSG.HOSTNAME_TAKEN);
    }
  }
}

function snapshot(a: Asset) {
  return {
    hostname: a.hostname,
    ipAddress: a.ipAddress,
    component: a.component,
    bpdId: a.bpdId,
    picName: a.picName,
    picContact: a.picContact,
    notes: a.notes,
    isActive: a.isActive,
  };
}
