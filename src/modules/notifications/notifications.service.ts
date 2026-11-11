import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AlertAction, NotifStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramService } from './telegram.service';
import { AlertMessageContext, buildAlertMessage, formatJakarta } from './alert-message';
import { MSG } from '../../common/constants/messages';
import { paginate, PaginationQueryDto } from '../../common/dto/pagination.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * Mengirim notifikasi alert tanpa memblokir pemanggil. Kegagalan kirim hanya dicatat
   * di NotificationLog dan tidak pernah membatalkan perubahan status alert.
   */
  notifyAlert(alertId: string, event: AlertAction, ctx: AlertMessageContext & { chatId?: string | null } = {}): void {
    void this.deliver(alertId, event, ctx).catch((e) =>
      this.logger.error(`Notifikasi alert ${alertId} gagal diproses: ${(e as Error).message}`),
    );
  }

  private async deliver(alertId: string, event: AlertAction, ctx: AlertMessageContext & { chatId?: string | null }) {
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId },
      include: { asset: { include: { host: true } } },
    });
    if (!alert) return;
    const message = buildAlertMessage(alert, event, ctx);
    const result = await this.telegram.send(message, ctx.chatId);
    await this.prisma.notificationLog.create({
      data: {
        alertId,
        event,
        message,
        status: result.ok ? NotifStatus.SENT : result.skipped ? NotifStatus.SKIPPED : NotifStatus.FAILED,
        error: result.ok ? null : result.error,
      },
    });
  }

  async sendTest(actor: string) {
    if (!this.telegram.configured) throw new BadRequestException(MSG.TELEGRAM_NOT_CONFIGURED);
    const message = `✅ <b>Pesan uji SYNRA</b>\nDikirim oleh ${actor} pada ${formatJakarta(new Date())}.`;
    const result = await this.telegram.send(message);
    await this.prisma.notificationLog.create({
      data: {
        event: AlertAction.CREATED,
        message,
        status: result.ok ? NotifStatus.SENT : NotifStatus.FAILED,
        error: result.ok ? null : result.error,
      },
    });
    if (!result.ok) throw new BadRequestException(MSG.TELEGRAM_FAILED(result.error));
    return { sent: true };
  }

  async list(q: PaginationQueryDto & { alertId?: string; status?: NotifStatus }) {
    const where: Prisma.NotificationLogWhereInput = { alertId: q.alertId, status: q.status };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.limit,
        include: { alert: { select: { number: true, severity: true, problem: true } } },
      }),
      this.prisma.notificationLog.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  status() {
    return { telegramConfigured: this.telegram.configured };
  }
}
