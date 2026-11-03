import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, ClientOptions } from '@elastic/elasticsearch';
import { readFileSync } from 'fs';

/**
 * Wrapper client Elasticsearch. SYNRA hanya membaca (search, PIT, aggregation);
 * tidak ada operasi tulis ke ES dari backend.
 */
@Injectable()
export class ElasticsearchService implements OnModuleDestroy {
  private readonly logger = new Logger(ElasticsearchService.name);
  readonly client: Client;

  constructor(config: ConfigService) {
    const options: ClientOptions = {
      node: config.get<string>('ELASTICSEARCH_NODE', 'http://localhost:9200'),
      requestTimeout: 30_000,
      maxRetries: 2,
    };
    const apiKey = config.get<string>('ELASTICSEARCH_API_KEY');
    const username = config.get<string>('ELASTICSEARCH_USERNAME');
    if (apiKey) {
      options.auth = { apiKey };
    } else if (username) {
      options.auth = { username, password: config.get<string>('ELASTICSEARCH_PASSWORD', '') };
    }
    const caPath = config.get<string>('ELASTICSEARCH_CA_CERT_PATH');
    options.tls = {
      rejectUnauthorized: config.get<boolean>('ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED', true),
      ...(caPath ? { ca: readFileSync(caPath) } : {}),
    };
    this.client = new Client(options);
  }

  async ping(): Promise<boolean> {
    try {
      return await this.client.ping();
    } catch (e) {
      this.logger.warn(`Ping Elasticsearch gagal: ${(e as Error).message}`);
      return false;
    }
  }

  async onModuleDestroy() {
    await this.client.close();
  }
}
