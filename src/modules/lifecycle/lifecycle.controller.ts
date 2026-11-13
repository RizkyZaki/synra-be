import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { LifecycleService } from './lifecycle.service';
import {
  CreateLifecycleItemDto,
  CreateRenewalDto,
  DecideRenewalDto,
  ListLifecycleQueryDto,
  ListRenewalsQueryDto,
  UpdateExpiryThresholdsDto,
  UpdateLifecycleItemDto,
} from './dto/lifecycle.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ParseUuid } from '../../common/pipes/parse-uuid.pipe';

/**
 * Siklus hidup: OS, lisensi, sertifikat SSL/TLS, garansi, kontrak vendor.
 * Semua role boleh membaca. Kelola item dan memutuskan perpanjangan: ADMIN dan SUPERVISOR.
 * Mengajukan perpanjangan: ADMIN, SUPERVISOR, OPERATOR.
 */
@ApiTags('Lifecycle')
@ApiBearerAuth()
@Controller('lifecycle')
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  /** Daftar item, urut dari yang paling cepat berakhir. Tiap item membawa daysLeft dan expiryLevel. */
  @Get()
  list(@Query() q: ListLifecycleQueryDto) {
    return this.lifecycle.list(q);
  }

  /** Batas sisa hari per level urgensi (CRITICAL, HIGH, MEDIUM, LOW). */
  @Get('thresholds')
  thresholds() {
    return this.lifecycle.expiryThresholds();
  }

  /** Mengubah batas hari. Harus naik berurutan: CRITICAL < HIGH < MEDIUM < LOW. Tercatat di audit. */
  @Roles(Role.ADMIN)
  @Put('thresholds')
  updateThresholds(@Body() dto: UpdateExpiryThresholdsDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.lifecycle.updateExpiryThresholds(dto, actor, meta);
  }

  @Get('renewals')
  listRenewals(@Query() q: ListRenewalsQueryDto) {
    return this.lifecycle.listRenewals(q);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch('renewals/:id')
  decide(
    @Param('id', ParseUuid) id: string,
    @Body() dto: DecideRenewalDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.lifecycle.decideRenewal(id, dto, actor, meta);
  }

  @Get(':id')
  get(@Param('id', ParseUuid) id: string) {
    return this.lifecycle.get(id);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Post()
  create(@Body() dto: CreateLifecycleItemDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.lifecycle.create(dto, actor, meta);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch(':id')
  update(
    @Param('id', ParseUuid) id: string,
    @Body() dto: UpdateLifecycleItemDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.lifecycle.update(id, dto, actor, meta);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUuid) id: string, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.lifecycle.remove(id, actor, meta);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.OPERATOR)
  @Post(':id/renewals')
  requestRenewal(
    @Param('id', ParseUuid) id: string,
    @Body() dto: CreateRenewalDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.lifecycle.requestRenewal(id, dto, actor, meta);
  }
}
