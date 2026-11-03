import { BadRequestException, ParseUUIDPipe } from '@nestjs/common';

/** ParseUUIDPipe dengan pesan error Bahasa Indonesia. */
export const ParseUuid = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException('ID tidak valid.'),
});
