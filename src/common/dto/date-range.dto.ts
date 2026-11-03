import { BadRequestException } from '@nestjs/common';
import { IsISO8601, IsOptional } from 'class-validator';
import { MSG } from '../constants/messages';

export class DateRangeDto {
  /** ISO 8601. Default: 24 jam terakhir */
  @IsOptional()
  @IsISO8601({}, { message: 'from harus berupa tanggal ISO 8601.' })
  from?: string;

  /** ISO 8601. Default: sekarang */
  @IsOptional()
  @IsISO8601({}, { message: 'to harus berupa tanggal ISO 8601.' })
  to?: string;
}

const MAX_RANGE_MS = 90 * 24 * 3600_000;

/** Menerjemahkan from/to menjadi Date dengan default 24 jam terakhir dan validasi rentang. */
export function resolveRange(q: DateRangeDto, defaultHours = 24): { from: Date; to: Date } {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - defaultHours * 3600_000);
  if (from >= to) throw new BadRequestException(MSG.DATE_RANGE_INVALID);
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new BadRequestException(MSG.DATE_RANGE_TOO_LONG);
  }
  return { from, to };
}
