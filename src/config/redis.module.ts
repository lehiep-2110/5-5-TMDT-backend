import { Global, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (cs: ConfigService): Redis => {
        const logger = new Logger('RedisModule');
        const host = cs.get<string>('REDIS_HOST', 'localhost');
        const port = Number(cs.get<string>('REDIS_PORT', '6380'));
        const client = new Redis({
          host,
          port,
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        });
        client.on('error', (err) => {
          logger.error(`Redis error: ${err.message}`);
        });
        client.on('connect', () => {
          logger.log(`Redis connected on ${host}:${port}`);
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor() {}

  async onModuleDestroy(): Promise<void> {
    // ioredis cleans up on process exit; nothing required here
  }
}
