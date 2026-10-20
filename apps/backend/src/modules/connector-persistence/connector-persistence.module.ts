import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ConnectorConnectionEntity,
  ConnectorCredentialEntity,
  OAuthStateEntity,
} from './entities';
import {
  CredentialEncryptionService,
  CONNECTOR_PERSISTENCE_OPTIONS,
} from './credential-encryption.service';
import { OAuthStateService } from './oauth-state.service';
import { ConnectorPersistenceService } from './connector-persistence.service';
import {
  ConnectorPersistenceAsyncOptions,
  ConnectorPersistenceOptions,
  ConnectorPersistenceOptionsFactory,
} from './interfaces/connector-options.interface';

/* Self-contained, portable module managing durable connector persistence and credential security */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConnectorConnectionEntity,
      ConnectorCredentialEntity,
      OAuthStateEntity,
    ]),
  ],
  providers: [
    CredentialEncryptionService,
    OAuthStateService,
    ConnectorPersistenceService,
  ],
  exports: [
    ConnectorPersistenceService,
    CredentialEncryptionService,
    OAuthStateService,
  ],
})
export class ConnectorPersistenceModule {
  /* Synchronous dynamic module registration */
  static register(options: ConnectorPersistenceOptions): DynamicModule {
    return {
      module: ConnectorPersistenceModule,
      providers: [
        {
          provide: CONNECTOR_PERSISTENCE_OPTIONS,
          useValue: options,
        },
      ],
    };
  }

  /* Alias for register */
  static forRoot(options: ConnectorPersistenceOptions): DynamicModule {
    return this.register(options);
  }

  /* Asynchronous dynamic module registration */
  static registerAsync(
    options: ConnectorPersistenceAsyncOptions,
  ): DynamicModule {
    return {
      module: ConnectorPersistenceModule,
      imports: options.imports || [],
      providers: this.createAsyncProviders(options),
    };
  }

  /* Alias for registerAsync */
  static forRootAsync(
    options: ConnectorPersistenceAsyncOptions,
  ): DynamicModule {
    return this.registerAsync(options);
  }

  private static createAsyncProviders(
    options: ConnectorPersistenceAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: CONNECTOR_PERSISTENCE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ];
    }

    if (options.useExisting || options.useClass) {
      const target = (options.useExisting || options.useClass)!;
      return [
        {
          provide: CONNECTOR_PERSISTENCE_OPTIONS,
          useFactory: async (optionsFactory: ConnectorPersistenceOptionsFactory) =>
            optionsFactory.createConnectorPersistenceOptions(),
          inject: [target],
        },
        ...(options.useClass
          ? [
              {
                provide: options.useClass,
                useClass: options.useClass,
              },
            ]
          : []),
      ];
    }

    return [];
  }
}
