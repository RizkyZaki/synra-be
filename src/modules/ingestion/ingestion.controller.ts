import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IngestionService } from './ingestion.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@ApiTags('Ingestion')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPERVISOR, Role.OPERATOR)
@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  /** Status scheduler, cursor per index, dan koneksi Elasticsearch. */
  @Get('status')
  status() {
    return this.ingestion.status();
  }

  /** Riwayat run ingest (termasuk host yang belum terdaftar). */
  @Get('runs')
  runs(@Query() q: PaginationQueryDto) {
    return this.ingestion.listRuns(q);
  }

  /** Menjalankan ingest + evaluasi threshold sekarang. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  run() {
    return this.ingestion.runManually();
  }

  /**
   * Impor metrik dari CSV (fallback bila Elasticsearch tidak dapat diakses).
   * Kolom: hostname, metric (CPU|MEMORY|DISK|UPTIME), value, timestamp (ISO 8601), label (mount point, opsional).
   */
  @Post('import-csv')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) =>
        /\.csv$/i.test(file.originalname) || /csv|text\/plain|excel/.test(file.mimetype)
          ? cb(null, true)
          : cb(new BadRequestException('File harus berformat .csv'), false),
    }),
  )
  importCsv(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.ingestion.importCsv(file, actor, meta);
  }
}

