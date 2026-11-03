import { Role } from '@prisma/client';

export class AuthUserDto {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

export class LoginResponseDto {
  accessToken: string;
  tokenType: 'Bearer';
  /** Masa berlaku token, mis. "8h" */
  expiresIn: string;
  user: AuthUserDto;
}
