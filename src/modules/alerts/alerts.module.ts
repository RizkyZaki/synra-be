import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertsEngineService } from './alerts-engine.service';
import { AlertAttachmentsService } from './alert-attachments.service';
import { ThresholdsModule } from '../thresholds/thresholds.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BackupsModule } from '../backups/backups.module';

@Module({
  imports: [ThresholdsModule, NotificationsModule, BackupsModule],
  controllers: [AlertsController],
  providers: [AlertsService, AlertsEngineService, AlertAttachmentsService],
  exports: [AlertsService, AlertsEngineService],
})
export class AlertsModule {}
