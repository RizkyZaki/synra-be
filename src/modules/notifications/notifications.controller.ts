import { Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { NotifStatus, Role } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

class ListNotificationsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'alertId harus berupa UUID yang valid.' })
  alertId?: string;

  @IsOptional()
  @IsEnum(NotifStatus, { message: 'status harus SENT, FAILED, atau SKIPPED.' })
  status?: NotifStatus;
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Riwayat pengiriman notifikasi Telegram. */
  @Get()
  list(@Query() q: ListNotificationsQueryDto) {
    return this.notifications.list(q);
  }

  /** Apakah Telegram sudah dikonfigurasi. */
  @Get('status')
  status() {
    return this.notifications.status();
  }

  /** Mengirim pesan uji ke chat Telegram yang dikonfigurasi. */
  @Roles(Role.ADMIN)
  @Post('test')
  @HttpCode(HttpStatus.OK)
  test(@CurrentUser() actor: AuthUser) {
    return this.notifications.sendTest(actor.username);
  }
}
