import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AlertsService } from './alerts.service';
import { AlertsEngineService } from './alerts-engine.service';
import {
  AlertAttachmentsService,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_FILES_PER_UPLOAD,
  isAllowedAttachment,
} from './alert-attachments.service';
import { MSG } from '../../common/constants/messages';
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
    private readonly attachments: AlertAttachmentsService,
  ) {}

  /** Daftar alert. Filter: status (koma / "open"), severity, metric, aset, Host, komponen, rentang waktu deteksi. */
  @Get()
  list(@Query() q: ListAlertsQueryDto) {
    return this.alerts.list(q);
  }

  /** Detail alert beserta timeline penanganan dan riwayat notifikasi. */
  @Get(':id')
  get(@Param('id', ParseUuid) id: string) {
    return this.alerts.get(id);
  }

  /**
   * Unggah lampiran bukti remediasi (field "files", maks. 5 file @ 10 MB per unggahan).
   * Jenis: PNG, JPG, WEBP, PDF, TXT, LOG, CSV. Lampiran tidak bisa dihapus.
   */
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.OPERATOR)
  @Post(':id/attachments')
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string', format: 'binary' } } } } })
  @UseInterceptors(
    FilesInterceptor('files', ATTACHMENT_MAX_FILES_PER_UPLOAD, {
      limits: { fileSize: ATTACHMENT_MAX_BYTES },
      fileFilter: (_req, file, cb) =>
        isAllowedAttachment(file.originalname) ? cb(null, true) : cb(new BadRequestException(MSG.ATTACHMENT_TYPE), false),
    }),
  )
  uploadAttachments(
    @Param('id', ParseUuid) id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.attachments.upload(id, files, actor, meta);
  }

  /** Unduh satu lampiran. Gambar dan PDF dikirim inline, file teks sebagai unduhan. */
  @Get(':id/attachments/:attachmentId')
  downloadAttachment(@Param('id', ParseUuid) id: string, @Param('attachmentId', ParseUuid) attachmentId: string) {
    return this.attachments.download(id, attachmentId);
  }

  /** Menjalankan evaluasi threshold sekarang (tombol "Evaluasi EWS"). */
  @Roles(Role.ADMIN)
  @Post('evaluate')
  @HttpCode(HttpStatus.OK)
  evaluate(@CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.engine.evaluateManually(actor, meta);
  }

  /** NEW → ACKNOWLEDGED */
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.OPERATOR)
  @Patch(':id/acknowledge')
  acknowledge(@Param('id', ParseUuid) id: string, @Body() dto: AlertNoteDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.alerts.transition(id, 'acknowledge', dto, actor, meta);
  }

  /** ACKNOWLEDGED → IN_PROGRESS (mulai remediasi, catatan wajib) */
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.OPERATOR)
  @Patch(':id/start')
  start(@Param('id', ParseUuid) id: string, @Body() dto: AlertRequiredNoteDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.alerts.transition(id, 'start', dto, actor, meta);
  }

  /** IN_PROGRESS → PENDING_REVIEW (catatan dan bukti remediasi wajib) */
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.OPERATOR)
  @Patch(':id/submit-review')
  submitReview(@Param('id', ParseUuid) id: string, @Body() dto: SubmitReviewDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.alerts.transition(id, 'submitReview', dto, actor, meta);
  }

  /** PENDING_REVIEW → IN_PROGRESS (dikembalikan oleh reviewer, catatan wajib) */
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch(':id/return')
  return(@Param('id', ParseUuid) id: string, @Body() dto: AlertRequiredNoteDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.alerts.transition(id, 'return', dto, actor, meta);
  }

  /** → CLOSED. Catatan wajib. Normalnya dari PENDING_REVIEW; ADMIN dan SUPERVISOR juga dapat menutup langsung (mis. false positive). */
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  @Patch(':id/close')
  close(@Param('id', ParseUuid) id: string, @Body() dto: AlertRequiredNoteDto, @CurrentUser() actor: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.alerts.transition(id, 'close', dto, actor, meta);
  }
}
