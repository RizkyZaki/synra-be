import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, LifecycleItem, LifecycleStatus, Prisma, RenewalRequest, RenewalStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta } from '../../common/decorators/request-meta.decorator';
import { MSG } from '../../common/constants/messages';
import { paginate } from '../../common/dto/pagination.dto';
import {
  CreateLifecycleItemDto,
  CreateRenewalDto,
  DecideRenewalDto,
  ListLifecycleQueryDto,
  ListRenewalsQueryDto,
  UpdateLifecycleItemDto,
} from './dto/lifecycle.dto';
import { daysBetween, expiryLevel, nextCode, renewalCode, toDateOnly, todayIn } from './lifecycle-rules';

type ItemWithPending = LifecycleItem & { _count?: { renewals: number } };
type RenewalWithItem = RenewalRequest & { item: Pick<LifecycleItem, 'code' | 'name' | 'category'> };

@Injectable()
export class LifecycleService {
  private readonly tz: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.tz = config.get<string>('REPORT_TIMEZONE', 'Asia/Jakarta');
  }

  async list(q: ListLifecycleQueryDto) {
    const where: Prisma.LifecycleItemWhereInput = {
      category: q.category,
      status: q.status,
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { code: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(q.expiringWithinDays !== undefined
        ? { expiryDate: { lte: new Date(Date.parse(`${this.today()}T00:00:00Z`) + q.expiringWithinDays * 86_400_000) } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.lifecycleItem.findMany({
        where,
        orderBy: [{ expiryDate: 'asc' }, { code: 'asc' }],
        skip: q.skip,
        take: q.limit,
        include: { _count: { select: { renewals: { where: { status: RenewalStatus.PENDING } } } } },
      }),
      this.prisma.lifecycleItem.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.present(r)),
      total,
      q,
    );
  }

  async get(id: string) {
    const item = await this.prisma.lifecycleItem.findUnique({
      where: { id },
      include: {
        renewals: { orderBy: { createdAt: 'desc' } },
        _count: { select: { renewals: { where: { status: RenewalStatus.PENDING } } } },
      },
    });
    if (!item) throw new NotFoundException(MSG.LIFECYCLE_NOT_FOUND);
    const { renewals, ...rest } = item;
    return {
      ...this.present(rest),
      renewals: renewals.map((r) => this.presentRenewal({ ...r, item: { code: item.code, name: item.name, category: item.category } })),
    };
  }

  async create(dto: CreateLifecycleItemDto, actor: AuthUser, meta: RequestMeta) {
    assertQuota(dto.quantity ?? 1, dto.allocated ?? 0);
    const existing = await this.prisma.lifecycleItem.findMany({ where: { category: dto.category }, select: { code: true } });
    const code = nextCode(
      dto.category,
      existing.map((e) => e.code),
    );
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.lifecycleItem.create({
        data: { ...dto, code, expiryDate: new Date(`${dto.expiryDate}T00:00:00Z`), createdById: actor.id, updatedById: actor.id },
      });
      await this.audit.log(
        { action: AuditAction.LIFECYCLE_CREATE, actorId: actor.id, actorUsername: actor.username, entity: 'LifecycleItem', entityId: item.id, after: snapshot(item), meta },
        tx,
      );
      return this.present(item);
    });
  }

  async update(id: string, dto: UpdateLifecycleItemDto, actor: AuthUser, meta: RequestMeta) {
    const before = await this.findItem(id);
    assertQuota(dto.quantity ?? before.quantity, dto.allocated ?? before.allocated);
    // Kategori menentukan prefix kode, jadi tidak boleh dipindah setelah dibuat.
    const { category: _ignored, expiryDate, ...rest } = dto;
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.lifecycleItem.update({
        where: { id },
        data: { ...rest, ...(expiryDate ? { expiryDate: new Date(`${expiryDate}T00:00:00Z`) } : {}), updatedById: actor.id },
      });
      await this.audit.log(
        { action: AuditAction.LIFECYCLE_UPDATE, actorId: actor.id, actorUsername: actor.username, entity: 'LifecycleItem', entityId: id, before: snapshot(before), after: snapshot(item), meta },
        tx,
      );
      return this.present(item);
    });
  }

  async remove(id: string, actor: AuthUser, meta: RequestMeta) {
    const before = await this.findItem(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.lifecycleItem.delete({ where: { id } });
      await this.audit.log(
        { action: AuditAction.LIFECYCLE_DELETE, actorId: actor.id, actorUsername: actor.username, entity: 'LifecycleItem', entityId: id, before: snapshot(before), meta },
        tx,
      );
    });
  }

  async listRenewals(q: ListRenewalsQueryDto) {
    const where: Prisma.RenewalRequestWhereInput = { status: q.status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.renewalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.limit,
        include: { item: { select: { code: true, name: true, category: true } } },
      }),
      this.prisma.renewalRequest.count({ where }),
    ]);
    return paginate(
      rows.map((r) => this.presentRenewal(r)),
      total,
      q,
    );
  }

  async requestRenewal(itemId: string, dto: CreateRenewalDto, actor: AuthUser, meta: RequestMeta) {
    const item = await this.findItem(itemId);
    const pending = await this.prisma.renewalRequest.count({ where: { itemId, status: RenewalStatus.PENDING } });
    if (pending > 0) throw new ConflictException(MSG.RENEWAL_PENDING_EXISTS);
    const name = await this.actorName(actor);
    return this.prisma.$transaction(async (tx) => {
      const renewal = await tx.renewalRequest.create({
        data: { itemId, note: dto.note, requestedById: actor.id, requestedByName: name },
      });
      await this.audit.log(
        {
          action: AuditAction.RENEWAL_REQUEST,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'RenewalRequest',
          entityId: renewal.id,
          after: { code: renewalCode(renewal.number), itemCode: item.code, itemName: item.name, note: dto.note ?? null },
          meta,
        },
        tx,
      );
      return this.presentRenewal({ ...renewal, item });
    });
  }

  async decideRenewal(id: string, dto: DecideRenewalDto, actor: AuthUser, meta: RequestMeta) {
    const renewal = await this.prisma.renewalRequest.findUnique({ where: { id }, include: { item: true } });
    if (!renewal) throw new NotFoundException(MSG.RENEWAL_NOT_FOUND);
    if (renewal.status !== RenewalStatus.PENDING) throw new ConflictException(MSG.RENEWAL_ALREADY_DECIDED);
    const approved = dto.status === RenewalStatus.APPROVED;
    const newExpiry = approved ? dto.newExpiryDate : undefined;
    if (newExpiry && newExpiry <= toDateOnly(renewal.item.expiryDate)) {
      throw new BadRequestException(MSG.RENEWAL_EXPIRY_NOT_LATER);
    }
    const name = await this.actorName(actor);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.renewalRequest.update({
        where: { id },
        data: { status: dto.status, decisionNote: dto.note, decidedById: actor.id, decidedByName: name, decidedAt: new Date() },
      });
      if (newExpiry) {
        await tx.lifecycleItem.update({
          where: { id: renewal.itemId },
          data: { expiryDate: new Date(`${newExpiry}T00:00:00Z`), status: LifecycleStatus.RENEWED, updatedById: actor.id },
        });
      }
      await this.audit.log(
        {
          action: AuditAction.RENEWAL_DECIDE,
          actorId: actor.id,
          actorUsername: actor.username,
          entity: 'RenewalRequest',
          entityId: id,
          before: { status: renewal.status, expiryDate: toDateOnly(renewal.item.expiryDate) },
          after: {
            code: renewalCode(renewal.number),
            itemCode: renewal.item.code,
            itemName: renewal.item.name,
            status: dto.status,
            note: dto.note ?? null,
            expiryDate: newExpiry ?? toDateOnly(renewal.item.expiryDate),
          },
          meta,
        },
        tx,
      );
      return this.presentRenewal({ ...updated, item: renewal.item });
    });
  }

  private async findItem(id: string): Promise<LifecycleItem> {
    const item = await this.prisma.lifecycleItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(MSG.LIFECYCLE_NOT_FOUND);
    return item;
  }

  private async actorName(actor: AuthUser): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { fullName: true } });
    return user?.fullName ?? actor.username;
  }

  private today(): string {
    return todayIn(this.tz);
  }

  private present(item: ItemWithPending) {
    const { _count, expiryDate, createdById: _c, updatedById: _u, ...rest } = item;
    const expiry = toDateOnly(expiryDate);
    const daysLeft = daysBetween(this.today(), expiry);
    return {
      ...rest,
      expiryDate: expiry,
      daysLeft,
      expiryLevel: expiryLevel(daysLeft),
      pendingRenewals: _count?.renewals ?? 0,
    };
  }

  private presentRenewal(r: RenewalWithItem) {
    return {
      id: r.id,
      code: renewalCode(r.number),
      itemId: r.itemId,
      itemCode: r.item.code,
      itemName: r.item.name,
      category: r.item.category,
      status: r.status,
      note: r.note,
      requestedByName: r.requestedByName,
      decidedByName: r.decidedByName,
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt,
      createdAt: r.createdAt,
    };
  }
}

function assertQuota(quantity: number, allocated: number) {
  if (allocated > quantity) throw new BadRequestException(MSG.LIFECYCLE_QUOTA);
}

function snapshot(item: LifecycleItem): Prisma.InputJsonValue {
  return {
    code: item.code,
    name: item.name,
    category: item.category,
    status: item.status,
    expiryDate: toDateOnly(item.expiryDate),
    quantity: item.quantity,
    allocated: item.allocated,
    location: item.location,
    picName: item.picName,
    vendor: item.vendor,
  };
}
