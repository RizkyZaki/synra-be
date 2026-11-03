import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { ScopeFilterDto } from '../../common/dto/scope-filter.dto';
import { ScopedRangeDto, TopAlertsQueryDto, TrendQueryDto, UtilizationQueryDto } from './dto/dashboard.dto';

/** Semua endpoint dashboard dapat difilter per BPD (bpdId) dan komponen (component). */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Ringkasan: total aset, online, warning, critical, stale, alert terbuka per severity dan status. */
  @Get('summary')
  summary(@Query() q: ScopeFilterDto) {
    return this.dashboard.summary(q);
  }

  /** Tren satu metrik per aset (atau rata-rata lintas aset bila assetId kosong) dalam rentang waktu. */
  @Get('trends')
  trends(@Query() q: TrendQueryDto) {
    return this.dashboard.trends(q);
  }

  /** Rata-rata CPU, memori, dan disk lintas aset per bucket waktu. */
  @Get('utilization')
  utilization(@Query() q: UtilizationQueryDto) {
    return this.dashboard.utilization(q);
  }

  /** Alert terbuka teratas (severity tertinggi, lalu terbaru). */
  @Get('top-alerts')
  topAlerts(@Query() q: TopAlertsQueryDto) {
    return this.dashboard.topAlerts(q);
  }

  /** Availability % per aset dan rata-rata dalam rentang waktu. */
  @Get('availability')
  availability(@Query() q: ScopedRangeDto) {
    return this.dashboard.availability(q);
  }
}
