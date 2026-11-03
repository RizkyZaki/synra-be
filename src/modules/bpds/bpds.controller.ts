import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { BpdsService } from './bpds.service';
import { CreateBpdDto, UpdateBpdDto } from './dto/bpd.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ParseUuid } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('BPD')
@ApiBearerAuth()
@Controller('bpds')
export class BpdsController {
  constructor(private readonly bpds: BpdsService) {}

  /** Daftar BPD beserta jumlah aset. */
  @Get()
  list() {
    return this.bpds.list();
  }

  @Get(':id')
  get(@Param('id', ParseUuid) id: string) {
    return this.bpds.get(id);
  }

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateBpdDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.bpds.create(dto, actor, meta);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(
    @Param('id', ParseUuid) id: string,
    @Body() dto: UpdateBpdDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.bpds.update(id, dto, actor, meta);
  }

  /** Hanya bisa dihapus bila tidak memiliki aset. */
  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUuid) id: string, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.bpds.remove(id, actor, meta);
  }
}
