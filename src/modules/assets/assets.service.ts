import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AlertStatus, Asset, AssetCategory, AuditAction, Host, Prisma, Role, Severity } from '@prisma/client';
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

type AssetWithHost = Asset & { host: Host };
type UserRef = { id: string; fullName: string };

export interface AssetView {
  id: string;
  hostname: string;
  ipAddress: string;
  component: string;
  host: { id: string; code: string; name: string };
  category: AssetCategory | null;
  type: string | null;
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
  userInput: UserRef | null;
  dtimeInput: Date;
  userUpdate: UserRef | null;
  timeUpdate: Date | null;
  supervisorInput: UserRef | null;
  supervisorUpdate: UserRef | null;
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
      ...(q.category ? { category: q.category } : {}),
      ...(q.type ? { type: q.type } : {}),
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
    await this.ensureHost(dto.hostId);
    await this.ensureHostnameFree(dto.hostname);
    const { supervisorInputId, ...data } = dto;
    const supervisorId = await this.resolveSupervisor(supervisorInputId, actor);
    const asset = await this.prisma.$transaction(async (tx) => {
      const created = await tx.asset.create({
        data: { ...data, userInputId: actor.id, supervisorInputId: supervisorId },
      });
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
    if (dto.hostId) await this.ensureHost(dto.hostId);
    if (dto.hostname && dto.hostname !== before.hostname) await this.ensureHostnameFree(dto.hostname);
    const { supervisorUpdateId, ...data } = dto;
    const supervisorId = await this.resolveSupervisor(supervisorUpdateId, actor);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.asset.update({
        where: { id },
        data: { ...data, userUpdateId: actor.id, timeUpdate: new Date(), supervisorUpdateId: supervisorId },
      });
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
    const assets: AssetWithHost[] = await this.prisma.asset.findMany({
      where,
      include: { host: true },
      orderBy: [{ host: { name: 'asc' } }, { hostname: 'asc' }],
    });
    const ids = assets.map((a) => a.id);
    const userIds = assets.flatMap((a) => [a.userInputId, a.userUpdateId, a.supervisorInputId, a.supervisorUpdateId]);
    const [snapshots, openAlerts, users] = await Promise.all([
      this.metrics.latestSnapshots(ids),
      this.prisma.alert.findMany({
        where: { assetId: { in: ids }, status: { not: AlertStatus.CLOSED } },
        select: { assetId: true, severity: true, conditionActive: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: userIds.filter((id): id is string => id !== null) } },
        select: { id: true, fullName: true },
      }),
    ]);
    const userById = new Map(users.map((u) => [u.id, u]));
    const userRef = (id: string | null): UserRef | null => (id ? (userById.get(id) ?? null) : null);
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
        host: { id: a.host.id, code: a.host.code, name: a.host.name },
        category: a.category,
        type: a.type,
        picName: a.picName,
        picContact: a.picContact,
        notes: a.notes,
        isActive: a.isActive,
        isStale: a.isStale,
        lastSeenAt: a.lastSeenAt,
        status: deriveAssetStatus({ isActive: a.isActive, isStale: a.isStale, openAlertMaxSeverity: max }),
        latest: snapshots.get(a.id)!,
        openAlerts: { count: open.length, activeCount: active.length, maxSeverity: max },
        userInput: userRef(a.userInputId),
        dtimeInput: a.dtimeInput,
        userUpdate: userRef(a.userUpdateId),
        timeUpdate: a.timeUpdate,
        supervisorInput: userRef(a.supervisorInputId),
        supervisorUpdate: userRef(a.supervisorUpdateId),
        updatedAt: a.updatedAt,
      };
    });
  }

  private async findOrFail(id: string): Promise<Asset> {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException(MSG.ASSET_NOT_FOUND);
    return asset;
  }

  private async ensureHost(hostId: string) {
    if (!(await this.prisma.host.findUnique({ where: { id: hostId } }))) {
      throw new NotFoundException(MSG.HOST_NOT_FOUND);
    }
  }

  /** Supervisor yang dipilih harus user aktif ber-role SUPERVISOR; bila kosong, supervisor yang login dipakai sendiri. */
  private async resolveSupervisor(id: string | undefined, actor: AuthUser): Promise<string | null> {
    if (!id) return actor.role === Role.SUPERVISOR ? actor.id : null;
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || !user.isActive || user.role !== Role.SUPERVISOR) {
      throw new BadRequestException(MSG.SUPERVISOR_INVALID);
    }
    return id;
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
    hostId: a.hostId,
    category: a.category,
    type: a.type,
    supervisorInputId: a.supervisorInputId,
    supervisorUpdateId: a.supervisorUpdateId,
    picName: a.picName,
    picContact: a.picContact,
    notes: a.notes,
    isActive: a.isActive,
  };
}
