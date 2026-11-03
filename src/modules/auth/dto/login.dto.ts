import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  /** @example admin */
  @IsString({ message: 'Username harus berupa teks.' })
  @IsNotEmpty({ message: 'Username wajib diisi.' })
  @MaxLength(50, { message: 'Username maksimal 50 karakter.' })
  username: string;

  /** @example GantiPassword123 */
  @IsString({ message: 'Password harus berupa teks.' })
  @IsNotEmpty({ message: 'Password wajib diisi.' })
  @MaxLength(128, { message: 'Password maksimal 128 karakter.' })
  password: string;
}
