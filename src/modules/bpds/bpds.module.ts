import { Module } from '@nestjs/common';
import { BpdsController } from './bpds.controller';
import { BpdsService } from './bpds.service';

@Module({
  controllers: [BpdsController],
  providers: [BpdsService],
})
export class BpdsModule {}
