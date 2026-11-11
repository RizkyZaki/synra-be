import { BadRequestException, Body, Controller, Get, Param, ParseEnumPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role, Severity } from '@prisma/client';
import { EscalationService } from './escalation.service';
import { UpdateEscalationPolicyDto } from './dto/escalation.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';

const severityPipe = new ParseEnumPipe(Severity, {
  exceptionFactory: () => new BadRequestException(`Severity harus salah satu dari: ${Object.values(Severity).join(', ')}.`),
});

/**
 * Matriks eskalasi: batas respon (diakui) dan penyelesaian (ditutup) per severity, serta tingkat
 * eskalasi berjenjang ke Telegram. Semua role boleh membaca; hanya ADMIN yang boleh mengubah.
 */
@ApiTags('Escalation')
@ApiBearerAuth()
@Controller('escalation')
export class EscalationController {
  constructor(private readonly escalation: EscalationService) {}

  @Get('policies')
  policies() {
    return this.escalation.policies();
  }

  /** Mengganti kebijakan satu severity beserta seluruh tingkat eskalasinya. */
  @Roles(Role.ADMIN)
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
