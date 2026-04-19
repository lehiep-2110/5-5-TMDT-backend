import { DataSource, DataSourceOptions } from 'typeorm';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

// Load .env from be/ first, then fallback to root .env
dotenvConfig({ path: resolve(__dirname, '../../.env') });
dotenvConfig({ path: resolve(__dirname, '../../../.env') });

export const typeormConfig: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5433,
  username: process.env.DB_USER || 'bookstore',
  password: process.env.DB_PASSWORD || 'bookstore',
  database: process.env.DB_NAME || 'bookstore',
  entities: [resolve(__dirname, '../database/entities/*.entity.{ts,js}')],
  migrations: [resolve(__dirname, '../database/migrations/*.{ts,js}')],
  migrationsTableName: 'migrations',
  synchronize: false,
  logging: false,
};

const dataSource = new DataSource(typeormConfig);
export default dataSource;
