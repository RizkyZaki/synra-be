import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateBpdDto {
  /** Kode unik, huruf besar/angka/strip. @example BPD-JTG */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString({ message: 'Kode BPD harus berupa teks.' })
  @Matches(/^[A-Z0-9-]{2,20}$/, {
    message: 'Kode BPD 2–20 karakter, hanya huruf besar, angka, atau strip.',
  })
  code: string;

  /** @example Bank Jateng */
  @Transform(trim)
  @IsString({ message: 'Nama BPD harus berupa teks.' })
  @IsNotEmpty({ message: 'Nama BPD wajib diisi.' })
  @MaxLength(100, { message: 'Nama BPD maksimal 100 karakter.' })
  name: string;

  /** @example Jawa Tengah */
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Wilayah harus berupa teks.' })
  @MaxLength(100, { message: 'Wilayah maksimal 100 karakter.' })
  region?: string;
}

export class UpdateBpdDto extends PartialType(CreateBpdDto) {}
