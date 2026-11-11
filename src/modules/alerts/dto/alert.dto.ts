import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AlertStatus, RuleMetric, Severity } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Menerima "NEW,ACKNOWLEDGED" atau parameter berulang. */
const csvList = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value;

export class ListAlertsQueryDto extends PaginationQueryDto {
  /** Satu atau beberapa status, dipisah koma. Gunakan "open" untuk semua yang belum CLOSED. */
  @IsOptional()
  @Transform(csvList)
  @IsString({ each: true })
  status?: string[];

  @IsOptional()
  @Transform(csvList)
  @IsEnum(Severity, { each: true, message: `severity harus salah satu dari: ${Object.values(Severity).join(', ')}.` })
  severity?: Severity[];

  @IsOptional()
  @IsEnum(RuleMetric, { message: `metric harus salah satu dari: ${Object.values(RuleMetric).join(', ')}.` })
  metric?: RuleMetric;

  @IsOptional()
  @IsUUID('4', { message: 'assetId harus berupa UUID yang valid.' })
  assetId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'hostId harus berupa UUID yang valid.' })
  hostId?: string;

  @IsOptional()
  @IsString({ message: 'component harus berupa teks.' })
  component?: string;

  /** Filter waktu deteksi (ISO 8601) */
  @IsOptional()
  @IsISO8601({}, { message: 'from harus berupa tanggal ISO 8601.' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to harus berupa tanggal ISO 8601.' })
  to?: string;

  /** Cari di masalah, hostname, atau nomor alert (mis. ALT-012) */
  @IsOptional()
  @IsString({ message: 'search harus berupa teks.' })
  @MaxLength(100, { message: 'search maksimal 100 karakter.' })
  search?: string;
}

export class AlertNoteDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Catatan harus berupa teks.' })
  @MaxLength(2000, { message: 'Catatan maksimal 2000 karakter.' })
  note?: string;
}

export class AlertRequiredNoteDto {
  @Transform(trim)
  @IsString({ message: 'Catatan harus berupa teks.' })
  @IsNotEmpty({ message: 'Catatan wajib diisi.' })
  @MaxLength(2000, { message: 'Catatan maksimal 2000 karakter.' })
  note: string;
}

export class SubmitReviewDto extends AlertRequiredNoteDto {
  /**
   * Referensi tiket, log, atau bukti validasi. Boleh kosong bila sudah ada lampiran
   * (POST /alerts/:id/attachments); salah satu wajib ada.
   */
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Bukti remediasi harus berupa teks.' })
  @MaxLength(1000, { message: 'Bukti remediasi maksimal 1000 karakter.' })
  evidence?: string;
}

export const ALERT_STATUSES = Object.values(AlertStatus);
