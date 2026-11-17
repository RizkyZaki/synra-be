import { Body, Controller, Get, Param, ParseEnumPipe, Patch, Put, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RuleMetric } from '@prisma/client';
import { ThresholdsService } from './thresholds.service';
import { ReplaceThresholdsDto, UpdateThresholdRuleDto } from './dto/threshold.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReqMeta, RequestMeta } from '../../common/decorators/request-meta.decorator';
import { ParseUuid } from '../../common/pipes/parse-uuid.pipe';

const metricPipe = new ParseEnumPipe(RuleMetric, {
  exceptionFactory: () =>
    new BadRequestException(`Metrik harus salah satu dari: ${Object.values(RuleMetric).join(', ')}.`),
});

@ApiTags('Thresholds')
@ApiBearerAuth()
@Controller('thresholds')
export class ThresholdsController {
  constructor(private readonly thresholds: ThresholdsService) {}

  /** Semua aturan, dikelompokkan per metrik. */
  @Get()
  list() {
    return this.thresholds.list();
  }

  /**
   * Mengganti seluruh level satu metrik. Ditolak bila nilai level aktif tidak naik
   * sesuai urutan severity. Perubahan dicatat di audit (nilai sebelum dan sesudah).
   */
  @RequirePermission('thresholds.manage')
  @Put(':metric')
  replace(
    @Param('metric', metricPipe) metric: RuleMetric,
    @Body() dto: ReplaceThresholdsDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.thresholds.replace(metric, dto, actor, meta);
  }

  /** Mengubah satu level (nilai, operator, aktif, rekomendasi). */
  @RequirePermission('thresholds.manage')
  @Patch('rule/:id')
  update(
    @Param('id', ParseUuid) id: string,
    @Body() dto: UpdateThresholdRuleDto,
    @CurrentUser() actor: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.thresholds.updateRule(id, dto, actor, meta);
  }
}
