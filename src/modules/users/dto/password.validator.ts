import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Kebijakan password: 8–128 karakter, minimal satu huruf dan satu angka. */
export function IsStrongPassword() {
  return applyDecorators(
    IsString({ message: 'Password harus berupa teks.' }),
    MinLength(8, { message: 'Password minimal 8 karakter.' }),
    MaxLength(128, { message: 'Password maksimal 128 karakter.' }),
    Matches(/[A-Za-z]/, { message: 'Password harus mengandung minimal satu huruf.' }),
    Matches(/\d/, { message: 'Password harus mengandung minimal satu angka.' }),
  );
}
