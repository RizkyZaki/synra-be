import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';

/** Filter BPD dan komponen yang dipakai bersama oleh aset, alert, dashboard, dan laporan. */
export class ScopeFilterDto {
  @IsOptional()
  @IsUUID('4', { message: 'bpdId harus berupa UUID yang valid.' })
  bpdId?: string;

  /** Mis. CORE_BANKING, DATABASE */
  @IsOptional()
  @IsString({ message: 'component harus berupa teks.' })
  @MaxLength(50, { message: 'component maksimal 50 karakter.' })
  component?: string;
}

export function assetScope(scope: ScopeFilterDto): Prisma.AssetWhereInput {
  return {
    ...(scope.bpdId ? { bpdId: scope.bpdId } : {}),
    ...(scope.component ? { component: scope.component } : {}),
  };
}
