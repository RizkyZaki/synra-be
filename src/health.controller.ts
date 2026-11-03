import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { ElasticsearchService } from './modules/elasticsearch/elasticsearch.service';
import { Public } from './common/decorators/public.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly es: ElasticsearchService,
  ) {}

  /**
   * Status layanan. Database wajib tersedia (503 bila tidak). Elasticsearch hanya dilaporkan,
   * karena backend tetap berfungsi (dashboard, impor CSV) saat ES tidak dapat diakses.
   */
  @Public()
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database tidak dapat dihubungi.');
    }
    const elasticsearch = (await this.es.ping()) ? 'up' : 'down';
    return { status: 'ok', database: 'up', elasticsearch, timestamp: new Date().toISOString() };
  }
}
