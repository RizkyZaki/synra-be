import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { ElasticsearchModule } from './modules/elasticsearch/elasticsearch.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { HostsModule } from './modules/hosts/hosts.module';
import { AssetsModule } from './modules/assets/assets.module';
import { ThresholdsModule } from './modules/thresholds/thresholds.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { LifecycleModule } from './modules/lifecycle/lifecycle.module';
import { BackupsModule } from './modules/backups/backups.module';
import { EscalationModule } from './modules/escalation/escalation.module';
import { SecurityModule } from './modules/security/security.module';
import { HealthController } from './health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    ElasticsearchModule,
    MetricsModule,
    AuthModule,
    UsersModule,
    HostsModule,
    AssetsModule,
    ThresholdsModule,
    NotificationsModule,
    AlertsModule,
    IngestionModule,
    DashboardModule,
    ReportsModule,
    LifecycleModule,
    BackupsModule,
    EscalationModule,
    SecurityModule,
  ],
  controllers: [HealthController],
  providers: [
    // Urutan penting: autentikasi dulu, baru otorisasi role.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
