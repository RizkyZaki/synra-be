import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIP,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { AssetStatus } from '../asset-status';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateAssetDto {
  /** Harus sama persis dengan host.name di Metricbeat/Filebeat. @example cbs-app-jtg-01 */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsString({ message: 'Hostname harus berupa teks.' })
  @Matches(/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/, {
    message: 'Hostname hanya boleh berisi huruf kecil, angka, titik, atau strip.',
  })
  hostname: string;

  /** @example 10.10.1.11 */
  @Transform(trim)
  @IsIP(undefined, { message: 'Alamat IP tidak valid.' })
  ipAddress: string;

  /** Mis. CORE_BANKING, DATABASE, WEB, MIDDLEWARE. @example CORE_BANKING */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase().replace(/\s+/g, '_') : value))
  @IsString({ message: 'Komponen harus berupa teks.' })
  @Matches(/^[A-Z0-9_]{2,50}$/, { message: 'Komponen 2–50 karakter (huruf, angka, garis bawah).' })
  component: string;

  @IsUUID('4', { message: 'BPD tidak valid.' })
  bpdId: string;

  /** @example Tim Infrastruktur */
  @Transform(trim)
  @IsString({ message: 'PIC harus berupa teks.' })
  @IsNotEmpty({ message: 'PIC wajib diisi.' })
  @MaxLength(100, { message: 'PIC maksimal 100 karakter.' })
  picName: string;

  /** Nomor telepon atau username Telegram PIC */
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Kontak PIC harus berupa teks.' })
  @MaxLength(100, { message: 'Kontak PIC maksimal 100 karakter.' })
  picContact?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Catatan harus berupa teks.' })
  @MaxLength(500, { message: 'Catatan maksimal 500 karakter.' })
  notes?: string;
}

export class UpdateAssetDto extends PartialType(CreateAssetDto) {
  @IsOptional()
  @IsBoolean({ message: 'isActive harus bernilai true atau false.' })
  isActive?: boolean;
}

export class ListAssetsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID('4', { message: 'bpdId harus berupa UUID yang valid.' })
  bpdId?: string;

  @IsOptional()
  @IsString({ message: 'component harus berupa teks.' })
  component?: string;

  @IsOptional()
  @IsEnum(AssetStatus, { message: `status harus salah satu dari: ${Object.values(AssetStatus).join(', ')}.` })
  status?: AssetStatus;

  /** Cari hostname, IP, atau PIC */
  @IsOptional()
  @IsString({ message: 'search harus berupa teks.' })
  @MaxLength(100, { message: 'search maksimal 100 karakter.' })
  search?: string;
}
