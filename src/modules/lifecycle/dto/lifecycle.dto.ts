import { PartialType } from '@nestjs/swagger';
import { LifecycleCategory, LifecycleStatus, RenewalStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

export class CreateLifecycleItemDto {
  /** @example Oracle Database Enterprise */
  @Transform(trim)
  @IsString({ message: 'Nama harus berupa teks.' })
  @IsNotEmpty({ message: 'Nama wajib diisi.' })
  @MaxLength(150, { message: 'Nama maksimal 150 karakter.' })
  name: string;

  @IsEnum(LifecycleCategory, { message: `Kategori harus salah satu dari: ${Object.values(LifecycleCategory).join(', ')}.` })
  category: LifecycleCategory;

  @IsOptional()
  @IsEnum(LifecycleStatus, { message: `Status harus salah satu dari: ${Object.values(LifecycleStatus).join(', ')}.` })
  status?: LifecycleStatus;

  /** Tanggal berakhir. @example 2027-01-15 */
  @IsISO8601({ strict: true }, { message: 'Tanggal berakhir harus berformat YYYY-MM-DD.' })
  expiryDate: string;

  /** Kuota atau jumlah unit. @example 20 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Jumlah harus bilangan bulat.' })
  @Min(1, { message: 'Jumlah minimal 1.' })
  quantity?: number;

  /** Yang sudah dipakai atau dialokasikan. @example 18 */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Jumlah terpakai harus bilangan bulat.' })
  @Min(0, { message: 'Jumlah terpakai minimal 0.' })
  allocated?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: 'Lokasi harus berupa teks.' })
  @MaxLength(100, { message: 'Lokasi maksimal 100 karakter.' })
  location?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: 'PIC harus berupa teks.' })
  @MaxLength(100, { message: 'PIC maksimal 100 karakter.' })
  picName?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: 'Vendor harus berupa teks.' })
  @MaxLength(100, { message: 'Vendor maksimal 100 karakter.' })
  vendor?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: 'Catatan harus berupa teks.' })
  @MaxLength(500, { message: 'Catatan maksimal 500 karakter.' })
  notes?: string;
}

export class UpdateLifecycleItemDto extends PartialType(CreateLifecycleItemDto) {}

export class ListLifecycleQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(LifecycleCategory, { message: 'Kategori tidak valid.' })
  category?: LifecycleCategory;

  @IsOptional()
  @IsEnum(LifecycleStatus, { message: 'Status tidak valid.' })
  status?: LifecycleStatus;

  /** Hanya item yang berakhir dalam N hari ke depan (termasuk yang sudah lewat). */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'expiringWithinDays harus bilangan bulat.' })
  @Min(0, { message: 'expiringWithinDays minimal 0.' })
  expiringWithinDays?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: 'search harus berupa teks.' })
  @MaxLength(100, { message: 'search maksimal 100 karakter.' })
  search?: string;
}

export class CreateRenewalDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: 'Catatan harus berupa teks.' })
  @MaxLength(500, { message: 'Catatan maksimal 500 karakter.' })
  note?: string;
}

export class DecideRenewalDto {
  @IsIn([RenewalStatus.APPROVED, RenewalStatus.REJECTED], { message: 'Keputusan harus APPROVED atau REJECTED.' })
  status: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString({ message: 'Catatan harus berupa teks.' })
  @MaxLength(500, { message: 'Catatan maksimal 500 karakter.' })
  note?: string;

  /** Bila disetujui: tanggal berakhir baru. Item otomatis berstatus RENEWED. @example 2027-11-01 */
  @IsOptional()
  @IsISO8601({ strict: true }, { message: 'Tanggal berakhir baru harus berformat YYYY-MM-DD.' })
  newExpiryDate?: string;
}

export class ListRenewalsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(RenewalStatus, { message: 'Status pengajuan tidak valid.' })
  status?: RenewalStatus;
}

const DAYS_MSG = 'Batas hari harus bilangan bulat 0–3650.';

/** Batas sisa hari (inklusif) per level urgensi. Field yang tidak dikirim tidak diubah. */
export class UpdateExpiryThresholdsDto {
  /** @example 30 */
  @IsOptional()
  @IsInt({ message: DAYS_MSG })
  @Min(0, { message: DAYS_MSG })
  @Max(3650, { message: DAYS_MSG })
  CRITICAL?: number;

  /** @example 90 */
  @IsOptional()
  @IsInt({ message: DAYS_MSG })
  @Min(0, { message: DAYS_MSG })
  @Max(3650, { message: DAYS_MSG })
  HIGH?: number;

  /** @example 180 */
  @IsOptional()
  @IsInt({ message: DAYS_MSG })
  @Min(0, { message: DAYS_MSG })
  @Max(3650, { message: DAYS_MSG })
  MEDIUM?: number;

  /** @example 365 */
  @IsOptional()
  @IsInt({ message: DAYS_MSG })
  @Min(0, { message: DAYS_MSG })
  @Max(3650, { message: DAYS_MSG })
  LOW?: number;
}
