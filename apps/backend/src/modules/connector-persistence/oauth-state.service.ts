import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull, MoreThan } from 'typeorm';
import * as crypto from 'crypto';
import { OAuthStateEntity } from './entities/oauth-state.entity';
import type { ConnectorPersistenceOptions } from './interfaces/connector-options.interface';
import { CONNECTOR_PERSISTENCE_OPTIONS } from './credential-encryption.service';

/* Service providing durable anti-CSRF OAuth state storage and atomic single-use verification */
@Injectable()
export class OAuthStateService {
  private readonly logger = new Logger(OAuthStateService.name);
  private readonly ttlMs: number;

  constructor(
    @InjectRepository(OAuthStateEntity)
    private readonly stateRepo: Repository<OAuthStateEntity>,
    @Optional()
    @Inject(CONNECTOR_PERSISTENCE_OPTIONS)
    options?: ConnectorPersistenceOptions,
  ) {
    this.ttlMs = options?.oauthStateTtlMs ?? 10 * 60 * 1000; /* 10 minutes */
  }

  /* Generates a cryptographically secure 32-byte hex state token and stores it in PostgreSQL */
  async generateState(
    provider: string,
    userId: string = 'admin-user',
  ): Promise<string> {
    const state = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);

    const record = this.stateRepo.create({
      state,
      provider,
      userId,
      expiresAt,
      consumedAt: null,
      createdAt: now,
    });

    await this.stateRepo.save(record);

    this.logger.log(`Generated durable OAuth state token for ${provider}`);
    return state;
  }

  /* Atomically verifies that a state token exists, is unconsumed, unexpired, and marks it consumed */
  async validateAndConsumeState(
    state: string,
    provider: string,
  ): Promise<boolean> {
    if (!state || !provider) {
      return false;
    }

    const now = new Date();

    /* Atomic update with single-use condition */
    const updateResult = await this.stateRepo
      .createQueryBuilder()
      .update(OAuthStateEntity)
      .set({ consumedAt: now })
      .where('state = :state', { state })
      .andWhere('provider = :provider', { provider })
      .andWhere('consumed_at IS NULL')
      .andWhere('expires_at > :now', { now })
      .execute();

    const wasConsumed = (updateResult.affected ?? 0) > 0;

    if (!wasConsumed) {
      this.logger.warn(
        `OAuth state validation failed: state is invalid, expired, or already replayed for ${provider}`,
      );
    }

    return wasConsumed;
  }

  /* Removes expired and already consumed state records */
  async cleanupExpiredStates(): Promise<number> {
    const now = new Date();
    const result = await this.stateRepo
      .createQueryBuilder()
      .delete()
      .from(OAuthStateEntity)
      .where('expires_at < :now OR consumed_at IS NOT NULL', { now })
      .execute();

    return result.affected ?? 0;
  }
}
