import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { SecurityService } from './security.service';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Ringkasan keamanan. Memuat username dan IP percobaan login gagal, jadi aksesnya
 * disamakan dengan audit log: ADMIN dan AUDITOR.
 */
@ApiTags('Security')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.AUDITOR)
@Controller('security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('overview')
  overview() {
    return this.security.overview();
  }
}
