import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AlertsService } from './alerts.service';
import { AlertsEngineService } from './alerts-engine.service';
import { AlertNoteDto, AlertRequiredNoteDto, ListAlertsQueryDto, SubmitReviewDto } from './dto/alert.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ParseUuid } from '../../common/pipes/parse-uuid.pipe';

@ApiTags('Alerts')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly engine: AlertsEngineService,
  ) {}

  /** Daftar alert. Filter: status (koma / "open"), severity, metric, aset, BPD, komponen, rentang waktu deteksi. */
  @Get()
  list(@Query() q: ListAlertsQueryDto) {
    return this.alerts.list(q);
  }

  /** Detail alert beserta timeline penanganan dan riwayat notifikasi. */
  @Get(':id')
  get(@Param('id', ParseUuid) id: string) {
    return this.alerts.get(id);
  }

  /** Menjalankan evaluasi threshold sekarang (tombol "Evaluasi EWS"). */
  @Roles(Role.ADMIN)
  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  evaluate(@CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.engine.evaluateManually(actor, meta);
  }

  /** NEW → ACKNOWLEDGED */
  @Roles(Role.ADMIN, Role.OPERATOR)
  @Patch(':id/acknowledge')
  acknowledge(@Param('id', ParseUuid) id: string, @Body() dto: AlertNoteDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.alerts.transition(id, 'acknowledge', dto, actor, meta);
  }

  /** ACKNOWLEDGED → IN_PROGRESS (mulai remediasi, catatan wajib) */
  @Roles(Role.ADMIN, Role.OPERATOR)
  @Patch(':id/start')
  start(@Param('id', ParseUuid) id: string, @Body() dto: AlertRequiredNoteDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.alerts.transition(id, 'start', dto, actor, meta);
  }

  /** IN_PROGRESS → PENDING_REVIEW (catatan dan bukti remediasi wajib) */
  @Roles(Role.ADMIN, Role.OPERATOR)
  @Patch(':id/submit-review')
  submitReview(@Param('id', ParseUuid) id: string, @Body() dto: SubmitReviewDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.alerts.transition(id, 'submitReview', dto, actor, meta);
  }

  /** PENDING_REVIEW → IN_PROGRESS (dikembalikan oleh reviewer, catatan wajib) */
  @Roles(Role.ADMIN)
  @Patch(':id/return')
  return(@Param('id', ParseUuid) id: string, @Body() dto: AlertRequiredNoteDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.alerts.transition(id, 'return', dto, actor, meta);
  }

  /** → CLOSED. Catatan wajib. Normalnya dari PENDING_REVIEW; ADMIN juga dapat menutup langsung (mis. false positive). */
  @Roles(Role.ADMIN)
  @Patch(':id/close')
  close(@Param('id', ParseUuid) id: string, @Body() dto: AlertRequiredNoteDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.alerts.transition(id, 'close', dto, actor, meta);
  }
}
