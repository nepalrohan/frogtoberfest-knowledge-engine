import { DataSource, DataSourceOptions } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

export const dataSourceOptions: DataSourceOptions = {
    type: 'postgres',
    url:
        process.env.DATABASE_URL ||
        'postgres://postgres:postgrespassword@localhost:5432/frogtoberfest',
    synchronize: false,
    logging: process.env.NODE_ENV === 'development',
    entities: [
        // path.join(__dirname, '../../typeorm/entities/*{.ts,.js}'),
        path.join(__dirname, '../**/*.entity{.ts,.js}'),
    ],
    migrations: [
        path.join(__dirname, '../migrations/*{.ts,.js}'),
    ],
};

/**
 * Shared TypeORM DataSource instance for backend application and Better Auth adapter.
 *
 * @remarks
 * - Connects to PostgreSQL with synchronize: false.
 * - Auto-detects Better Auth CLI generated migrations from `typeorm/migrations/`.
 */
const AppDataSource = new DataSource(dataSourceOptions);

export default AppDataSource;
