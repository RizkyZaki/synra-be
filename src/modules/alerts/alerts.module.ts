import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsEngineService } from './alerts-engine.service';
import { ThresholdsModule } from '../thresholds/thresholds.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ThresholdsModule, NotificationsModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsEngineService],
  exports: [AlertsService, AlertsEngineService],
})
export class AlertsModule {}
