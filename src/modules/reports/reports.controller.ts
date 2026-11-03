import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { DailyReportQueryDto, ExportReportQueryDto } from './dto/report.dto';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Laporan harian (JSON): ringkasan, statistik per aset, dan alert yang terdeteksi pada tanggal tersebut. */
  @Get('daily')
  daily(@Query() q: DailyReportQueryDto) {
    return this.reports.daily(q);
  }

  /** Ekspor laporan harian ke XLSX atau PDF. Setiap ekspor dicatat di audit log. */
  @Get('daily/export')
  @ApiProduces('application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async export(
    @Query() q: ExportReportQueryDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
    @Res() res: Response,
  ) {
    const file = await this.reports.export(q, actor, meta);
    res.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Content-Length': String(file.buffer.length),
      'Access-Control-Expose-Headers': 'Content-Disposition',
    });
    res.end(file.buffer);
  }
}
