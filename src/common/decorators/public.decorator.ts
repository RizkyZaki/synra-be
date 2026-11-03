import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Menandai endpoint yang tidak memerlukan JWT. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
