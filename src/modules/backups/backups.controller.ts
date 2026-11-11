import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BackupsService } from './backups.service';
import { ListBackupJobsQueryDto, ListBackupRunsQueryDto } from './dto/backup.dto';

/**
 * Status backup per job. Data berasal dari log JSON skrip backup yang dikirim Filebeat
 * (event.dataset = "synra.backup"). Semua role boleh membaca.
 */
@ApiTags('Backups')
@ApiBearerAuth()
@Controller('backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  /** Ringkasan, daftar job (status terakhir, gagal beruntun, umur backup), dan aset tanpa backup. */
  @Get('jobs')
  jobs(@Query() q: ListBackupJobsQueryDto) {
    return this.backups.listJobs(q);
  }

  /** Riwayat eksekusi backup, terbaru dulu. */
  @Get('runs')
  runs(@Query() q: ListBackupRunsQueryDto) {
    return this.backups.listRuns(q);
  }
}
