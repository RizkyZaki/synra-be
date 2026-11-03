import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Severity, ThresholdOperator } from '@prisma/client';

const SEV_MSG = `Severity harus salah satu dari: ${Object.values(Severity).join(', ')}.`;
const OP_MSG = 'Operator harus GT (>) atau GTE (≥).';

export class ThresholdLevelDto {
  @IsEnum(Severity, { message: SEV_MSG })
  severity: Severity;

  /** Default: GT */
  @IsOptional()
  @IsEnum(ThresholdOperator, { message: OP_MSG })
  operator?: ThresholdOperator;

  /** Persen (CPU/MEMORY/DISK) atau menit (HOST_STALE) */
  @IsNumber({}, { message: 'Nilai threshold harus berupa angka.' })
  value: number;

  /** Default: true */
  @IsOptional()
  @IsBoolean({ message: 'enabled harus bernilai true atau false.' })
  enabled?: boolean;

  @IsOptional()
  @IsString({ message: 'Rekomendasi harus berupa teks.' })
  @MaxLength(500, { message: 'Rekomendasi maksimal 500 karakter.' })
  recommendation?: string;
}

export class ReplaceThresholdsDto {
  @IsArray({ message: 'levels harus berupa array.' })
  @ArrayMinSize(1, { message: 'Minimal satu level threshold wajib diisi.' })
  @ArrayMaxSize(5, { message: 'Maksimal 5 level (satu per severity).' })
  @ValidateNested({ each: true })
  @Type(() => ThresholdLevelDto)
  levels: ThresholdLevelDto[];
}

export class UpdateThresholdRuleDto {
  @IsOptional()
  @IsEnum(ThresholdOperator, { message: OP_MSG })
  operator?: ThresholdOperator;

  @IsOptional()
  @IsNumber({}, { message: 'Nilai threshold harus berupa angka.' })
  value?: number;

  @IsOptional()
  @IsBoolean({ message: 'enabled harus bernilai true atau false.' })
  enabled?: boolean;

  @IsOptional()
  @IsString({ message: 'Rekomendasi harus berupa teks.' })
  @MaxLength(500, { message: 'Rekomendasi maksimal 500 karakter.' })
  recommendation?: string;
}
