import { IsIn, IsOptional, Matches } from 'class-validator';
import { ScopeFilterDto } from '../../../common/dto/scope-filter.dto';

export class DailyReportQueryDto extends ScopeFilterDto {
  /** Tanggal laporan (zona waktu REPORT_TIMEZONE). Default: hari ini. @example 2026-11-02 */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date harus berformat YYYY-MM-DD.' })
  date?: string;
}

export class ExportReportQueryDto extends DailyReportQueryDto {
  @IsIn(['xlsx', 'pdf'], { message: 'format harus xlsx atau pdf.' })
  format: 'xlsx' | 'pdf';
}
