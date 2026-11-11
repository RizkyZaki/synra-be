import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  PORT = 3000;

  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsString()
  JWT_EXPIRES_IN = '8h';

  @Type(() => Number)
  @IsInt()
  @Min(10)
  @Max(15)
  BCRYPT_ROUNDS = 12;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOGIN_MAX_ATTEMPTS = 5;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOGIN_LOCKOUT_MINUTES = 15;

  // ---------- Elasticsearch ----------
  @IsString()
  ELASTICSEARCH_NODE = 'http://localhost:9200';

  @IsOptional()
  @IsString()
  ELASTICSEARCH_USERNAME?: string;

  @IsOptional()
  @IsString()
  ELASTICSEARCH_PASSWORD?: string;

  @IsOptional()
  @IsString()
  ELASTICSEARCH_API_KEY?: string;

  @IsOptional()
  @IsString()
  ELASTICSEARCH_CA_CERT_PATH?: string;

  @Transform(toBool)
  @IsBoolean()
  ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED = true;

  @IsString()
  METRICBEAT_INDEX = 'metricbeat-*';

  @IsString()
  FILEBEAT_INDEX = 'filebeat-*';

  // ---------- Lampiran bukti remediasi ----------
  @IsString()
  UPLOAD_DIR = './uploads';

  // ---------- Ingestion ----------
  @Transform(toBool)
  @IsBoolean()
  INGEST_ENABLED = true;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  INGEST_INTERVAL_MINUTES = 5;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  INGEST_INITIAL_LOOKBACK_HOURS = 24;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  INGEST_OVERLAP_SECONDS = 60;

  @Type(() => Number)
  @IsInt()
  @Min(1000)
  INGEST_MAX_DOCS_PER_RUN = 50000;

  // ---------- Telegram ----------
  @IsOptional()
  @IsString()
  TELEGRAM_BOT_TOKEN?: string;

  @IsOptional()
  @IsString()
  TELEGRAM_CHAT_ID?: string;

  // ---------- Laporan ----------
  @IsString()
  REPORT_TIMEZONE = 'Asia/Jakarta';
}

function toBool({ value }: { value: unknown }) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes'].includes(value.toLowerCase());
  return value;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const detail = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Konfigurasi .env tidak valid:\n${detail}`);
  }
  return validated;
}
