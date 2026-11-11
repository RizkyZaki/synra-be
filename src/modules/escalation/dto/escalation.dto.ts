import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class EscalationStepDto {
  /** Menit sejak alert terdeteksi. @example 30 */
  @Type(() => Number)
  @IsInt({ message: 'Waktu eskalasi harus bilangan bulat (menit).' })
  @Min(1, { message: 'Waktu eskalasi minimal 1 menit.' })
  @Max(43200, { message: 'Waktu eskalasi maksimal 43200 menit (30 hari).' })
  afterMinutes: number;

  /** @example Kepala Departemen Infrastruktur */
  @Transform(trim)
  @IsString({ message: 'Tujuan eskalasi harus berupa teks.' })
  @IsNotEmpty({ message: 'Tujuan eskalasi wajib diisi.' })
  @MaxLength(80, { message: 'Tujuan eskalasi maksimal 80 karakter.' })
  targetLabel: string;

  /** Username Telegram yang di-mention, dipisah spasi. @example @budi_noc @sari_infra */
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^@[A-Za-z0-9_]{3,32}(\s+@[A-Za-z0-9_]{3,32}){0,4}$/, {
    message: 'Mention harus berupa username Telegram, mis. "@budi_noc" (maksimal 5, dipisah spasi).',
  })
  mention?: string | null;

  /** Chat Telegram tambahan untuk tingkat ini. Kosong = grup utama. @example -1001234567890 */
  @IsOptional()
  @Transform(emptyToNull)
  @Matches(/^-?\d{3,20}$/, { message: 'Chat ID Telegram harus berupa angka, mis. -1001234567890.' })
  telegramChatId?: string | null;
}

export class UpdateEscalationPolicyDto {
  /** Batas waktu alert diakui (menit). @example 15 */
  @Type(() => Number)
  @IsInt({ message: 'Batas respon harus bilangan bulat (menit).' })
  @Min(1, { message: 'Batas respon minimal 1 menit.' })
  @Max(10080, { message: 'Batas respon maksimal 10080 menit (7 hari).' })
  ackMinutes: number;

  /** Batas waktu alert ditutup (menit). @example 240 */
  @Type(() => Number)
  @IsInt({ message: 'Batas penyelesaian harus bilangan bulat (menit).' })
  @Min(1, { message: 'Batas penyelesaian minimal 1 menit.' })
  @Max(43200, { message: 'Batas penyelesaian maksimal 43200 menit (30 hari).' })
  resolveMinutes: number;

  @IsBoolean({ message: 'enabled harus bernilai true atau false.' })
  enabled: boolean;

  /** Tingkat eskalasi berurutan; level diberi otomatis sesuai urutan. */
  @IsArray({ message: 'steps harus berupa array.' })
  @ArrayMaxSize(6, { message: 'Maksimal 6 tingkat eskalasi.' })
  @ValidateNested({ each: true })
  @Type(() => EscalationStepDto)
  steps: EscalationStepDto[];
}
