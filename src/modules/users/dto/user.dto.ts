import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import { IsStrongPassword } from './password.validator';

const ROLE_MSG = `Role harus salah satu dari: ${Object.values(Role).join(', ')}.`;
const toLowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateUserDto {
  /** Huruf kecil, angka, titik, garis bawah, atau strip. @example operator1 */
  @Transform(toLowerTrim)
  @IsString({ message: 'Username harus berupa teks.' })
  @MinLength(3, { message: 'Username minimal 3 karakter.' })
  @MaxLength(50, { message: 'Username maksimal 50 karakter.' })
  @Matches(/^[a-z0-9._-]+$/, {
    message: 'Username hanya boleh berisi huruf kecil, angka, titik, garis bawah, atau strip.',
  })
  username: string;

  @IsStrongPassword()
  password: string;

  /** @example Budi Santoso */
  @Transform(trim)
  @IsString({ message: 'Nama lengkap harus berupa teks.' })
  @IsNotEmpty({ message: 'Nama lengkap wajib diisi.' })
  @MaxLength(100, { message: 'Nama lengkap maksimal 100 karakter.' })
  fullName: string;

  @IsEnum(Role, { message: ROLE_MSG })
  role: Role;
}

export class UpdateUserDto {
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Nama lengkap harus berupa teks.' })
  @IsNotEmpty({ message: 'Nama lengkap tidak boleh kosong.' })
  @MaxLength(100, { message: 'Nama lengkap maksimal 100 karakter.' })
  fullName?: string;

  @IsOptional()
  @IsEnum(Role, { message: ROLE_MSG })
  role?: Role;

  @IsOptional()
  @IsBoolean({ message: 'isActive harus bernilai true atau false.' })
  isActive?: boolean;
}

export class ResetPasswordDto {
  @IsStrongPassword()
  newPassword: string;
}

export class ListUsersQueryDto extends PaginationQueryDto {
  /** Cari berdasarkan username atau nama */
  @IsOptional()
  @IsString({ message: 'search harus berupa teks.' })
  @MaxLength(100, { message: 'search maksimal 100 karakter.' })
  search?: string;

  @IsOptional()
  @IsEnum(Role, { message: ROLE_MSG })
  role?: Role;

  @IsOptional()
  // Baca dari `obj` (nilai mentah query string) agar "false" tidak terkonversi menjadi true.
  @Transform(({ obj, key }) => {
    const raw = (obj as Record<string, unknown>)[key];
    return raw === 'true' ? true : raw === 'false' ? false : raw;
  })
  @IsBoolean({ message: 'isActive harus bernilai true atau false.' })
  isActive?: boolean;
}

export class UserResponseDto {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  isLocked: boolean;
  lockedUntil: Date | null;
  failedLoginCount: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
