import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { HostsService } from './hosts.service';
import { CreateHostDto, UpdateHostDto } from './dto/host.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ParseUuid } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('Host')
@ApiBearerAuth()
@Controller('hosts')
export class HostsController {
  constructor(private readonly hosts: HostsService) {}

  /** Daftar Host beserta jumlah aset. */
  @Get()
  list() {
    return this.hosts.list();
  }

  @Get(':id')
  get(@Param('id', ParseUuid) id: string) {
    return this.hosts.get(id);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Post()
  create(@Body() dto: CreateHostDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.hosts.create(dto, actor, meta);
  }

  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch(':id')
  update(
    @Param('id', ParseUuid) id: string,
    @Body() dto: UpdateHostDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.hosts.update(id, dto, actor, meta);
  }

  /** Hanya bisa dihapus bila tidak memiliki aset. */
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUuid) id: string, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.hosts.remove(id, actor, meta);
  }
}
