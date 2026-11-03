import { IntersectionType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { MetricType } from '@prisma/client';
import { ScopeFilterDto } from '../../../common/dto/scope-filter.dto';
import { DateRangeDto } from '../../../common/dto/date-range.dto';

export class ScopedRangeDto extends IntersectionType(ScopeFilterDto, DateRangeDto) {}

export class TrendQueryDto extends ScopedRangeDto {
  /** Kosongkan untuk rata-rata semua aset dalam scope BPD/komponen */
  @IsOptional()
  @IsUUID('4', { message: 'assetId harus berupa UUID yang valid.' })
  assetId?: string;

  @IsEnum(MetricType, { message: `metric harus salah satu dari: ${Object.values(MetricType).join(', ')}.` })
  metric: MetricType;

  /** Ukuran bucket (detik). Default: otomatis sesuai rentang. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'bucketSeconds harus bilangan bulat.' })
  @Min(60, { message: 'bucketSeconds minimal 60.' })
  @Max(86400, { message: 'bucketSeconds maksimal 86400.' })
  bucketSeconds?: number;
}

export class UtilizationQueryDto extends ScopedRangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'bucketSeconds harus bilangan bulat.' })
  @Min(60, { message: 'bucketSeconds minimal 60.' })
  @Max(86400, { message: 'bucketSeconds maksimal 86400.' })
  bucketSeconds?: number;
}

export class TopAlertsQueryDto extends ScopeFilterDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit harus bilangan bulat.' })
  @Min(1, { message: 'limit minimal 1.' })
  @Max(50, { message: 'limit maksimal 50.' })
  limit: number = 10;
}
