import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upperTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const uniqueStrings = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? [...new Set(value.map((v) => (typeof v === 'string' ? v.trim() : v)))] : value;

export class CreateRoleDto {
  /** @example Supervisor Jawa Timur */
  @Transform(trim)
  @IsString({ message: 'Nama role harus berupa teks.' })
  @IsNotEmpty({ message: 'Nama role wajib diisi.' })
  @MaxLength(50, { message: 'Nama role maksimal 50 karakter.' })
  name: string;

  /** Opsional. Bila kosong dibuat dari nama, mis. SUPERVISOR_JAWA_TIMUR. Tidak bisa diubah setelah dibuat. */
  @IsOptional()
  @Transform(upperTrim)
  @Matches(/^[A-Z][A-Z0-9_]{1,29}$/, {
    message: 'Kode role 2–30 karakter: huruf besar, angka, atau garis bawah, diawali huruf.',
  })
  code?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Deskripsi harus berupa teks.' })
  @MaxLength(200, { message: 'Deskripsi maksimal 200 karakter.' })
  description?: string;

  /** Kunci hak akses, lihat GET /roles/permissions. @example ["alerts.view","alerts.handle"] */
  @Transform(uniqueStrings)
  @IsArray({ message: 'permissions harus berupa daftar.' })
  @ArrayMaxSize(100, { message: 'permissions terlalu banyak.' })
  @IsString({ each: true, message: 'Setiap hak akses harus berupa teks.' })
  permissions: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Nama role harus berupa teks.' })
  @IsNotEmpty({ message: 'Nama role tidak boleh kosong.' })
  @MaxLength(50, { message: 'Nama role maksimal 50 karakter.' })
  name?: string;

  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Deskripsi harus berupa teks.' })
  @MaxLength(200, { message: 'Deskripsi maksimal 200 karakter.' })
  description?: string;

  @IsOptional()
  @Transform(uniqueStrings)
  @IsArray({ message: 'permissions harus berupa daftar.' })
  @ArrayMaxSize(100, { message: 'permissions terlalu banyak.' })
  @IsString({ each: true, message: 'Setiap hak akses harus berupa teks.' })
  permissions?: string[];
}

export class RoleResponseDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  /** Hak akses efektif (ADMIN = semua) */
  permissions: string[];
  /** Role bawaan: tidak dapat dihapus */
  isSystem: boolean;
  /** Role ADMIN: hak akses selalu penuh dan tidak dapat diubah */
  locked: boolean;
  userCount: number;
  createdAt: Date;
  updatedAt: Date;
}
