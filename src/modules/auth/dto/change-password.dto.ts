import { IsNotEmpty, IsString } from 'class-validator';
import { IsStrongPassword } from '../../users/dto/password.validator';

export class ChangePasswordDto {
  @IsString({ message: 'Password lama harus berupa teks.' })
  @IsNotEmpty({ message: 'Password lama wajib diisi.' })
  oldPassword: string;

  @IsStrongPassword()
  newPassword: string;
}
