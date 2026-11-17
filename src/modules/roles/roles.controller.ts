import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { CreateRoleDto, RoleResponseDto, UpdateRoleDto } from './dto/role.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ParseUuid } from '../../common/pipes/parse-uuid.pipe';

/**
 * Role dan hak akses. Membaca daftar role juga dibutuhkan pengelola pengguna (pilihan role di form user).
 * Pemberi hak yang bukan ADMIN hanya bisa memberikan hak akses yang ia miliki sendiri.
 */
@ApiTags('Roles')
@ApiBearerAuth()
@RequirePermission('roles.manage')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermission('roles.manage', 'users.manage')
  @Get()
  @ApiOkResponse({ type: [RoleResponseDto] })
  list() {
    return this.roles.list();
  }

  /** Katalog hak akses per kelompok (kunci, label, deskripsi). */
  @Get('permissions')
  catalog() {
    return this.roles.catalog();
  }

  @Get(':id')
  @ApiOkResponse({ type: RoleResponseDto })
  get(@Param('id', ParseUuid) id: string) {
    return this.roles.get(id);
  }

  @Post()
  @ApiOkResponse({ type: RoleResponseDto })
  create(@Body() dto: CreateRoleDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.roles.create(dto, actor, meta);
  }

  /** Ubah nama, deskripsi, atau hak akses. Hak role ADMIN tidak dapat diubah. Berlaku langsung untuk semua user role ini. */
  @Patch(':id')
  @ApiOkResponse({ type: RoleResponseDto })
  update(
    @Param('id', ParseUuid) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.roles.update(id, dto, actor, meta);
  }

  /** Hapus role buatan admin yang tidak dipakai user mana pun. Role sistem tidak dapat dihapus. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUuid) id: string, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.roles.remove(id, actor, meta);
  }
}
