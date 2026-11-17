import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  ListUsersQueryDto,
  ResetPasswordDto,
  UpdateUserDto,
  UserResponseDto,
} from './dto/user.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ParseUuid } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('Users')
@ApiBearerAuth()
@RequirePermission('users.manage')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query() q: ListUsersQueryDto) {
    return this.users.list(q);
  }

  /** Pilihan supervisor pada form aset. */
  @RequirePermission('users.manage', 'assets.manage')
  @Get('supervisors')
  supervisors() {
    return this.users.supervisors();
  }

  @Get(':id')
  @ApiOkResponse({ type: UserResponseDto })
  get(@Param('id', ParseUuid) id: string) {
    return this.users.get(id);
  }

  @Post()
  @ApiOkResponse({ type: UserResponseDto })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.users.create(dto, actor, meta);
  }

  /** Ubah nama, role, atau status aktif. Admin tidak bisa mengubah role/menonaktifkan diri sendiri. */
  @Patch(':id')
  @ApiOkResponse({ type: UserResponseDto })
  update(
    @Param('id', ParseUuid) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.users.update(id, dto, actor, meta);
  }

  /** Membuka kunci akun yang terkunci karena gagal login. */
  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UserResponseDto })
  unlock(@Param('id', ParseUuid) id: string, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.users.unlock(id, actor, meta);
  }

  /** Mengatur password baru untuk user lain (sekaligus membuka kunci akun). */
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @Param('id', ParseUuid) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.users.resetPassword(id, dto, actor, meta);
  }
}
