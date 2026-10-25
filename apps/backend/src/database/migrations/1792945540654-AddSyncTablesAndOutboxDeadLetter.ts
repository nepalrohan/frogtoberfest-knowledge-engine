import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSyncTablesAndOutboxDeadLetter1792945540654 implements MigrationInterface {
    name = 'AddSyncTablesAndOutboxDeadLetter1792945540654'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_f040c929ce1b0c9c7ac6e64d35"`);
        await queryRunner.query(`CREATE TABLE "connector_sync_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "connection_id" uuid NOT NULL, "external_resource_id" character varying(255) NOT NULL, "resource_type" character varying(50) NOT NULL DEFAULT 'page', "status" character varying(30) NOT NULL DEFAULT 'PENDING', "attempt_count" integer NOT NULL DEFAULT '0', "next_attempt_at" TIMESTAMP WITH TIME ZONE, "last_synced_at" TIMESTAMP WITH TIME ZONE, "last_observed_revision" character varying(255), "last_processed_fingerprint" character varying(64), "last_error" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9756e0c341f61468732dc4c80e6" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_connector_sync_items_status_next_attempt" ON "connector_sync_items"  ("status", "next_attempt_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_connector_sync_items_connection_resource" ON "connector_sync_items"  ("connection_id", "external_resource_id") `);
        await queryRunner.query(`CREATE TABLE "connector_sync_outbox" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "connection_id" uuid NOT NULL, "external_resource_id" character varying(255) NOT NULL, "event_type" character varying(50) NOT NULL DEFAULT 'SYNC_RESOURCE', "payload" jsonb NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'pending', "attempt_count" integer NOT NULL DEFAULT '0', "last_error" text, "next_attempt_at" TIMESTAMP WITH TIME ZONE, "claimed_at" TIMESTAMP WITH TIME ZONE, "published_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_797e6ebbb3aa86ebffdcd30541a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_connector_sync_outbox_claimable" ON "connector_sync_outbox"  ("next_attempt_at") WHERE "status" IN ('pending', 'publishing')`);
        await queryRunner.query(`CREATE INDEX "idx_connector_sync_outbox_pending" ON "connector_sync_outbox"  ("status", "created_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_document_source" ON "document"  ("source_type", "source_id") `);
        await queryRunner.query(`ALTER TABLE "connector_sync_items" ADD CONSTRAINT "FK_da6a67fcdb059eb97f5619398c8" FOREIGN KEY ("connection_id") REFERENCES "connector_connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "connector_sync_outbox" ADD CONSTRAINT "FK_9dfaf571da4e19afbbad8bcfb82" FOREIGN KEY ("connection_id") REFERENCES "connector_connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "connector_sync_outbox" DROP CONSTRAINT "FK_9dfaf571da4e19afbbad8bcfb82"`);
        await queryRunner.query(`ALTER TABLE "connector_sync_items" DROP CONSTRAINT "FK_da6a67fcdb059eb97f5619398c8"`);
        await queryRunner.query(`DROP INDEX "public"."uq_document_source"`);
        await queryRunner.query(`DROP INDEX "public"."idx_connector_sync_outbox_pending"`);
        await queryRunner.query(`DROP INDEX "public"."idx_connector_sync_outbox_claimable"`);
        await queryRunner.query(`DROP TABLE "connector_sync_outbox"`);
        await queryRunner.query(`DROP INDEX "public"."idx_connector_sync_items_connection_resource"`);
        await queryRunner.query(`DROP INDEX "public"."idx_connector_sync_items_status_next_attempt"`);
        await queryRunner.query(`DROP TABLE "connector_sync_items"`);
        await queryRunner.query(`CREATE INDEX "IDX_f040c929ce1b0c9c7ac6e64d35" ON "document" USING btree ("source_type", "source_id") `);
    }

}
