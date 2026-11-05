import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';

/** Filter Host dan komponen yang dipakai bersama oleh aset, alert, dashboard, dan laporan. */
export class ScopeFilterDto {
  @IsOptional()
  @IsUUID('4', { message: 'hostId harus berupa UUID yang valid.' })
  hostId?: string;

  /** Mis. CORE_BANKING, DATABASE */
  @IsOptional()
  @IsString({ message: 'component harus berupa teks.' })
  @MaxLength(50, { message: 'component maksimal 50 karakter.' })
  component?: string;
}

export function assetScope(scope: ScopeFilterDto): Prisma.AssetWhereInput {
  return {
    ...(scope.hostId ? { hostId: scope.hostId } : {}),
    ...(scope.component ? { component: scope.component } : {}),
  };
}
