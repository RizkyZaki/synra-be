import { BackupStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export const JOB_HEALTH = ['OK', 'FAILED', 'OVERDUE'] as const;
export type JobHealth = (typeof JOB_HEALTH)[number];

export class ListBackupJobsQueryDto {
  /** Cari hostname atau nama job */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: 'search harus berupa teks.' })
  @MaxLength(100, { message: 'search maksimal 100 karakter.' })
  search?: string;

  @IsOptional()
  @IsUUID('4', { message: 'hostId tidak valid.' })
  hostId?: string;

  /** OK, FAILED (eksekusi terakhir gagal), OVERDUE (terlalu lama tanpa backup sukses) */
  @IsOptional()
  @IsIn(JOB_HEALTH, { message: `health harus salah satu dari: ${JOB_HEALTH.join(', ')}.` })
  health?: JobHealth;
}

export class ListBackupRunsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'assetId tidak valid.' })
  assetId?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: 'jobName harus berupa teks.' })
  @MaxLength(80, { message: 'jobName maksimal 80 karakter.' })
  jobName?: string;

  @IsOptional()
  @IsEnum(BackupStatus, { message: 'status harus SUCCESS atau FAILED.' })
  status?: BackupStatus;
}
