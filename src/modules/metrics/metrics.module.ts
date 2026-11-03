import { Global, Module } from '@nestjs/common';
import { MetricsRepository } from './metrics.repository';

@Global()
@Module({
  providers: [MetricsRepository],
  exports: [MetricsRepository],
})
export class MetricsModule {}
