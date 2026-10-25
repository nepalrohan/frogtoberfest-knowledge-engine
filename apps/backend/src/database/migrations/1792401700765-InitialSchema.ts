import { MigrationInterface, QueryRunner } from 'typeorm';

/* Baseline schema: documents, retrieval-ready chunks (pgvector + full-text), ingestion jobs and embedding outbox */
export class InitialSchema1792401700765 implements MigrationInterface {
  name = 'InitialSchema1792401700765';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "vector"`);
    /* TypeORM tracks generated-column expressions here; current_database() keeps it portable across envs */
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (current_database(), current_schema(), $1, $2, $3, $4)`,
      [
        'document_chunk',
        'GENERATED_COLUMN',
        'search_vector',
        'to_tsvector(\'english\', "content")',
      ],
    );
    await queryRunner.query(
      `CREATE TABLE "document_chunk" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "document_id" uuid NOT NULL, "chunk_index" integer NOT NULL, "document_version" integer NOT NULL, "content" text NOT NULL, "embedding" vector(768) NOT NULL, "embedding_model" character varying(128) NOT NULL, "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED NOT NULL, "token_count" integer NOT NULL DEFAULT '0', "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_70d9772bf367d82f9b7e568c87c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chunk_search_vector" ON "document_chunk" USING gin ("search_vector") `,
    );
    /* Approximate nearest-neighbour index for cosine distance (<=>); not expressible via TypeORM decorators */
    await queryRunner.query(
      `CREATE INDEX "idx_chunk_embedding_hnsw" ON "document_chunk" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c182696e41b7ff7f821c7b7645" ON "document_chunk"  ("document_id", "chunk_index") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4ddf64f21eccc13009c3e4e907" ON "document_chunk"  ("document_id", "document_version") `,
    );
    await queryRunner.query(
      `CREATE TABLE "document" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "source_type" character varying(50) NOT NULL, "source_id" character varying(255) NOT NULL, "source_url" character varying(1024), "title" text NOT NULL, "raw_content" text, "normalized_content" text NOT NULL, "content_hash" character varying(64) NOT NULL, "version" integer NOT NULL DEFAULT '1', "sync_status" character varying(50) NOT NULL DEFAULT 'pending_embedding', "metadata" jsonb NOT NULL DEFAULT '{}', "source_updated_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_e57d3357f83f3cdc0acffc3d777" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f28605913b5027711ec3a7698" ON "document"  ("content_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f040c929ce1b0c9c7ac6e64d35" ON "document"  ("source_type", "source_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ingestion_job" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "source_type" character varying(50) NOT NULL, "trigger_type" character varying(50) NOT NULL DEFAULT 'manual', "status" character varying(50) NOT NULL DEFAULT 'pending', "cursor_state" text, "items_discovered" integer NOT NULL DEFAULT '0', "items_processed" integer NOT NULL DEFAULT '0', "items_failed" integer NOT NULL DEFAULT '0', "error_message" text, "started_at" TIMESTAMP WITH TIME ZONE, "finished_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9bce28c45e529ea38284b6aeac3" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2899cad0044897946e073ae1df" ON "ingestion_job"  ("source_type", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "embedding_outbox" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "document_id" uuid NOT NULL, "document_version" integer NOT NULL, "event_type" character varying(100) NOT NULL DEFAULT 'DOCUMENT_READY_FOR_EMBEDDING', "payload" jsonb NOT NULL, "status" character varying(50) NOT NULL DEFAULT 'pending', "retry_count" integer NOT NULL DEFAULT '0', "error_message" text, "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fc11c3a9fa4d43d263fdebe891f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4c2386886f0f5bf222486fe441" ON "embedding_outbox"  ("document_id", "document_version") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_942a5c8dad5126eb348f09c112" ON "embedding_outbox"  ("status", "created_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "document_chunk" ADD CONSTRAINT "FK_13fe21b6cbdda6d223de93c1b4b" FOREIGN KEY ("document_id") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "document_chunk" DROP CONSTRAINT "FK_13fe21b6cbdda6d223de93c1b4b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_942a5c8dad5126eb348f09c112"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4c2386886f0f5bf222486fe441"`,
    );
    await queryRunner.query(`DROP TABLE "embedding_outbox"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2899cad0044897946e073ae1df"`,
    );
    await queryRunner.query(`DROP TABLE "ingestion_job"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f040c929ce1b0c9c7ac6e64d35"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f28605913b5027711ec3a7698"`,
    );
    await queryRunner.query(`DROP TABLE "document"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4ddf64f21eccc13009c3e4e907"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c182696e41b7ff7f821c7b7645"`,
    );
    await queryRunner.query(`DROP INDEX "public"."idx_chunk_embedding_hnsw"`);
    await queryRunner.query(`DROP INDEX "public"."idx_chunk_search_vector"`);
    await queryRunner.query(`DROP TABLE "document_chunk"`);
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = current_database() AND "schema" = current_schema() AND "table" = $3`,
      ['GENERATED_COLUMN', 'search_vector', 'document_chunk'],
    );
  }
}
