import { Inject } from '@nestjs/common';
import { DataSource } from 'typeorm';

export const getRepositoryToken = (entity: any) =>
  `MockToken_${entity?.name || entity}`;

export const InjectRepository = (entity: any) =>
  Inject(getRepositoryToken(entity));

function matchWhere(item: any, where: any): boolean {
  if (Array.isArray(where)) {
    return where.some((w) => matchWhere(item, w));
  }
  if (!where || typeof where !== 'object') return true;
  for (const [key, val] of Object.entries(where)) {
    if (val && typeof val === 'object' && '_type' in (val as any)) {
      /* TypeORM FindOperator e.g. In([...]) */
      const op = val as any;
      if (op._type === 'in') {
        const list = op._value || [];
        if (!list.includes(item[key])) return false;
      }
    } else if (item[key] !== val) {
      return false;
    }
  }
  return true;
}

const entityStores = new Map<string, any[]>();
(global as any).__clearMockEntityStores = () => entityStores.clear();

function getStore(entityName: string): any[] {
  if (!entityStores.has(entityName)) {
    entityStores.set(entityName, []);
  }
  return entityStores.get(entityName)!;
}

export class MockRepository {
  private entityName: string;

  constructor(entityName = 'default') {
    this.entityName = entityName;
  }

  get data(): any[] {
    return getStore(this.entityName);
  }

  set data(items: any[]) {
    entityStores.set(this.entityName, items);
  }

  find = jest.fn().mockImplementation(async (options?: any) => {
    let result = [...this.data];
    if (options?.where) {
      result = result.filter((item) => matchWhere(item, options.where));
    }
    return result;
  });

  findOne = jest.fn().mockImplementation(async (options?: any) => {
    let item = options?.where
      ? this.data.find((i) => matchWhere(i, options.where)) || null
      : this.data[0] || null;

    if (item && options?.relations?.credential) {
      const credStore = getStore('ConnectorCredentialEntity');
      const cred = credStore.find((c) => c.connectionId === item.id);
      item = { ...item, credential: cred || null };
    }
    return item;
  });

  save = jest.fn().mockImplementation(
    async (entityOrClass: any, maybeEntity?: any) => {
      const entity = maybeEntity !== undefined ? maybeEntity : entityOrClass;
      if (!entity.id && !entity.state) {
        entity.id =
          'mock-id-' + Math.random().toString(36).substring(2, 9);
      }
      const key = entity.state ? 'state' : 'id';
      const index = this.data.findIndex((item) => item[key] === entity[key]);
      if (index >= 0) {
        this.data[index] = { ...this.data[index], ...entity };
        return this.data[index];
      } else {
        this.data.push(entity);
        return entity;
      }
    },
  );

  create = jest.fn().mockImplementation(
    (entityOrClass: any, maybeObj?: any) => {
      const obj = maybeObj !== undefined ? maybeObj : entityOrClass;
      return { ...obj };
    },
  );

  delete = jest.fn().mockImplementation(async (criteria?: any) => {
    const initialLen = this.data.length;
    if (typeof criteria === 'object') {
      this.data = this.data.filter((item) => !matchWhere(item, criteria));
    }
    return { affected: initialLen - this.data.length };
  });

  createQueryBuilder = jest.fn().mockImplementation(() => {
    const whereClauses: Array<{ field: string; val: any; op?: string }> = [];
    let setData: any = {};
    let isUpdate = false;
    let isDelete = false;

    const builder: any = {
      update: jest.fn().mockImplementation(() => {
        isUpdate = true;
        return builder;
      }),
      delete: jest.fn().mockImplementation(() => {
        isDelete = true;
        return builder;
      }),
      from: jest.fn().mockReturnThis(),
      set: jest.fn().mockImplementation((s: any) => {
        setData = s;
        return builder;
      }),
      where: jest.fn().mockImplementation((clause: string, params?: any) => {
        builder.andWhere(clause, params);
        return builder;
      }),
      andWhere: jest.fn().mockImplementation(
        (clause: string, params?: any) => {
          if (clause.includes('state = :state'))
            whereClauses.push({ field: 'state', val: params?.state });
          if (clause.includes('provider = :provider'))
            whereClauses.push({ field: 'provider', val: params?.provider });
          if (clause.includes('consumed_at IS NULL'))
            whereClauses.push({ field: 'consumedAt', val: null });
          if (clause.includes('expires_at > :now'))
            whereClauses.push({
              field: 'expiresAt',
              val: params?.now,
              op: '>',
            });
          return builder;
        },
      ),
      execute: jest.fn().mockImplementation(async () => {
        const matches = this.data.filter((item) => {
          return whereClauses.every((wc) => {
            if (wc.op === '>') {
              return (
                item[wc.field] &&
                new Date(item[wc.field]).getTime() >
                  new Date(wc.val).getTime()
              );
            }
            return item[wc.field] === wc.val;
          });
        });

        if (isUpdate) {
          matches.forEach((item) => {
            Object.assign(item, setData);
          });
          return { affected: matches.length };
        }

        if (isDelete) {
          const count = matches.length;
          this.data = this.data.filter((item) => !matches.includes(item));
          return { affected: count };
        }

        return { affected: 0 };
      }),
    };
    return builder;
  });
}

export class MockDataSource {
  transaction = jest
    .fn()
    .mockImplementation(async (cb: (manager: any) => Promise<any>) => {
      const manager: any = {
        findOne: (entityClass: any, options: any) => {
          const repo = new MockRepository(entityClass?.name || 'default');
          return repo.findOne(options);
        },
        find: (entityClass: any, options: any) => {
          const repo = new MockRepository(entityClass?.name || 'default');
          return repo.find(options);
        },
        save: (entityClassOrEntity: any, maybeEntity?: any) => {
          const entityClass =
            maybeEntity !== undefined ? entityClassOrEntity : null;
          const entity =
            maybeEntity !== undefined ? maybeEntity : entityClassOrEntity;
          const name =
            entityClass?.name || entity?.constructor?.name || 'default';
          const repo = new MockRepository(name);
          return repo.save(entity);
        },
        create: (entityClass: any, obj: any) => ({ ...obj }),
      };
      return cb(manager);
    });
}

class MockTypeOrmModule {}
class MockTypeOrmFeatureModule {}

export const TypeOrmModule = {
  forRoot: jest.fn().mockReturnValue({
    module: MockTypeOrmModule,
    global: true,
    providers: [{ provide: DataSource, useClass: MockDataSource }],
    exports: [{ provide: DataSource, useClass: MockDataSource }],
  }),
  forRootAsync: jest.fn().mockReturnValue({
    module: MockTypeOrmModule,
    global: true,
    providers: [{ provide: DataSource, useClass: MockDataSource }],
    exports: [{ provide: DataSource, useClass: MockDataSource }],
  }),
  forFeature: jest.fn().mockImplementation((entities: any[] = []) => {
    const providers = (entities || []).map((entity) => ({
      provide: getRepositoryToken(entity),
      useFactory: () => new MockRepository(entity?.name || 'default'),
    }));
    return {
      module: MockTypeOrmFeatureModule,
      providers,
      exports: providers,
    };
  }),
};
