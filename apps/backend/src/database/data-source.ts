import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { loadConfiguration } from '../config/configuration';
import { buildDataSourceOptions } from './data-source.options';

/* Entry point for the TypeORM CLI (migration:generate / run / revert); mirrors the env files Nest loads */
loadEnv({
  path: [`.env.${process.env.NODE_ENV || 'development'}`, '.env'],
  quiet: true,
});

export default new DataSource({
  ...buildDataSourceOptions(loadConfiguration().database),
  migrationsRun: false,
});
