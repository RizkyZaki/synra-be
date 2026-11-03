import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { AssetsModule } from '../assets/assets.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [AssetsModule, AlertsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
