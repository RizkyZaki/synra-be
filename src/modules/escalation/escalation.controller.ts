import { BadRequestException, Body, Controller, Get, Param, ParseEnumPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Severity } from '@prisma/client';
import { EscalationService } from './escalation.service';
import { UpdateEscalationPolicyDto } from './dto/escalation.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';

const severityPipe = new ParseEnumPipe(Severity, {
  exceptionFactory: () => new BadRequestException(`Severity harus salah satu dari: ${Object.values(Severity).join(', ')}.`),
});

/**
 * Matriks eskalasi: batas respon (diakui) dan penyelesaian (ditutup) per severity, serta tingkat
 * eskalasi berjenjang ke Telegram. Membaca: notifications.view; mengubah: escalation.manage.
 */
@ApiTags('Escalation')
@ApiBearerAuth()
@RequirePermission('notifications.view')
@Controller('escalation')
export class EscalationController {
  constructor(private readonly escalation: EscalationService) {}

  @Get('policies')
  policies() {
    return this.escalation.policies();
  }

  /** Mengganti kebijakan satu severity beserta seluruh tingkat eskalasinya. */
  @RequirePermission('escalation.manage')
  @Put('policies/:severity')
  update(
    @Param('severity', severityPipe) severity: Severity,
    @Body() dto: UpdateEscalationPolicyDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.escalation.update(severity, dto, actor, meta);
  }

  /** Alert terbuka dengan tenggat SLA, tingkat eskalasi saat ini dan berikutnya. */
  @Get('active')
  active() {
    return this.escalation.active();
  }
}
