import { MigrationInterface, QueryRunner } from "typeorm";

export class AddConnectorsEntities1792521063577 implements MigrationInterface {
    name = 'AddConnectorsEntities1792521063577'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "connector_credentials" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "connection_id" uuid NOT NULL, "auth_type" character varying(30) NOT NULL DEFAULT 'OAUTH2', "encrypted_payload" text NOT NULL, "encryption_key_version" integer NOT NULL DEFAULT '1', "expires_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "REL_9a4dcc003d0932f0b116c3b503" UNIQUE ("connection_id"), CONSTRAINT "PK_97b3e8697d708fc54798bac3794" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_connector_credentials_connection_id" ON "connector_credentials"  ("connection_id") `);
        await queryRunner.query(`CREATE TABLE "connector_connections" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "provider" character varying(50) NOT NULL, "status" character varying(30) NOT NULL DEFAULT 'CONNECTED', "external_account_id" character varying(255) NOT NULL, "external_account_name" character varying(255), "connected_by_user_id" character varying(100) NOT NULL DEFAULT 'admin-user', "metadata" jsonb, "connected_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_verified_at" TIMESTAMP WITH TIME ZONE, "disconnected_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_107932f165f86af81176ae739b9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_connector_connection_provider_active" ON "connector_connections"  ("provider") WHERE status IN ('CONNECTED', 'REAUTH_REQUIRED')`);
        await queryRunner.query(`CREATE INDEX "idx_connector_connection_provider_status" ON "connector_connections"  ("provider", "status") `);
        await queryRunner.query(`CREATE TABLE "oauth_states" ("state" character varying(64) NOT NULL, "provider" character varying(50) NOT NULL, "user_id" character varying(100) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2f6f171bfec24fe3d411b5cf973" PRIMARY KEY ("state"))`);
        await queryRunner.query(`CREATE INDEX "idx_oauth_states_expires_at" ON "oauth_states"  ("expires_at") `);
        await queryRunner.query(`ALTER TABLE "connector_credentials" ADD CONSTRAINT "FK_9a4dcc003d0932f0b116c3b5038" FOREIGN KEY ("connection_id") REFERENCES "connector_connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "connector_credentials" DROP CONSTRAINT "FK_9a4dcc003d0932f0b116c3b5038"`);
        await queryRunner.query(`DROP INDEX "public"."idx_oauth_states_expires_at"`);
        await queryRunner.query(`DROP TABLE "oauth_states"`);
        await queryRunner.query(`DROP INDEX "public"."idx_connector_connection_provider_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_connector_connection_provider_active"`);
        await queryRunner.query(`DROP TABLE "connector_connections"`);
        await queryRunner.query(`DROP INDEX "public"."idx_connector_credentials_connection_id"`);
        await queryRunner.query(`DROP TABLE "connector_credentials"`);
    }

}
