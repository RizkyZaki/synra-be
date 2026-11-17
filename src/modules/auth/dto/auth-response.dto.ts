export class RoleRefDto {
  id: string;
  /** @example SUPERVISOR */
  code: string;
  /** @example Supervisor */
  name: string;
}

export class AuthUserDto {
  id: string;
  username: string;
  fullName: string;
  role: RoleRefDto;
  /** Hak akses efektif role (ADMIN = semua). FE memakainya untuk menu dan tombol. */
  permissions: string[];
}

export class LoginResponseDto {
  accessToken: string;
  tokenType: 'Bearer';
  /** Masa berlaku token, mis. "8h" */
  expiresIn: string;
  user: AuthUserDto;
}
