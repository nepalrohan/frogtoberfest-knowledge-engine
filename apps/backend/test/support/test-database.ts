import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/data-source.options';

/* Integration specs run only when TEST_DATABASE_URL points at a disposable pgvector database */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

export const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/* Opens a migrated connection to the test database */
export async function openTestDataSource(): Promise<DataSource> {
  const url = new URL(testDatabaseUrl!);
  const dataSource = new DataSource(
    buildDataSourceOptions({
      host: url.hostname,
      port: Number(url.port || 5432),
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      ssl: false,
      synchronize: false,
    }),
  );
  await dataSource.initialize();
  await dataSource.runMigrations();
  return dataSource;
}

/* Empties the given tables between tests; CASCADE clears dependent rows */
export async function truncate(dataSource: DataSource, tables: string[]): Promise<void> {
  await dataSource.query(`TRUNCATE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`);
}
