import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AssetsService } from './assets.service';
import { CreateAssetDto, ListAssetsQueryDto, UpdateAssetDto } from './dto/asset.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ParseUuid } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('Assets')
@ApiBearerAuth()
@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  /** Daftar aset dengan status turunan (ONLINE/WARNING/CRITICAL/STALE/INACTIVE) dan metrik terakhir. */
  @Get()
  list(@Query() q: ListAssetsQueryDto) {
    return this.assets.list(q);
  }

  /** Daftar komponen unik untuk filter. */
  @Get('components')
  components() {
    return this.assets.components();
  }

  @Get(':id')
  get(@Param('id', ParseUuid) id: string) {
    return this.assets.get(id);
  }

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateAssetDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.assets.create(dto, actor, meta);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUuid) id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.assets.update(id, dto, actor, meta);
  }

  /** Hanya untuk aset tanpa riwayat alert; selain itu nonaktifkan lewat PATCH isActive=false. */
  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUuid) id: string, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.assets.remove(id, actor, meta);
  }
}
