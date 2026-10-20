import { MigrationInterface, QueryRunner } from 'typeorm';

/* Conversation history: threads and their messages, with per-answer sources and run diagnostics */
export class AddConversations1792408690173 implements MigrationInterface {
  name = 'AddConversations1792408690173';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "conversation_message" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversation_id" uuid NOT NULL, "role" character varying(16) NOT NULL, "content" text NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'completed', "outcome" character varying(16), "refusal_reason" character varying(32), "sources" jsonb NOT NULL DEFAULT '[]', "run" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2f8286c3560b52dba8428ac182e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7f72e4c3278c3577e60ef3a066" ON "conversation_message"  ("conversation_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "conversation" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "owner_id" character varying(128) NOT NULL DEFAULT 'local_user', "title" character varying(255) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_864528ec4274360a40f66c29845" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_84095e208ae6cda6139e52f6b7" ON "conversation"  ("owner_id", "updated_at") `,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_message" ADD CONSTRAINT "FK_fde1a45d37dfea0608d6f6166a7" FOREIGN KEY ("conversation_id") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversation_message" DROP CONSTRAINT "FK_fde1a45d37dfea0608d6f6166a7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_84095e208ae6cda6139e52f6b7"`,
    );
    await queryRunner.query(`DROP TABLE "conversation"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7f72e4c3278c3577e60ef3a066"`,
    );
    await queryRunner.query(`DROP TABLE "conversation_message"`);
  }
}
