import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SecurityService } from './security.service';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

/**
 * Ringkasan keamanan. Memuat username dan IP percobaan login gagal, jadi hak aksesnya
 * (security.view) secara default hanya diberikan ke ADMIN dan AUDITOR.
 */
@ApiTags('Security')
@ApiBearerAuth()
@RequirePermission('security.view')
@Controller('security')
export class SecurityController {
  constructor(private readonly security: SecurityService) {}

  @Get('overview')
  overview() {
    return this.security.overview();
  }
}
