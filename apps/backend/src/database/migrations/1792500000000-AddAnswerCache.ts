import { MigrationInterface, QueryRunner } from 'typeorm';

/* The key under which a standalone answer can be reused */
export class AddAnswerCache1792500000000 implements MigrationInterface {
  name = 'AddAnswerCache1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "conversation_message" ADD "answer_cache_key" character varying(64)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_conversation_message_answer_cache" ON "conversation_message" ("answer_cache_key", "created_at") WHERE "answer_cache_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_conversation_message_answer_cache"`,
    );
    await queryRunner.query(
      `ALTER TABLE "conversation_message" DROP COLUMN "answer_cache_key"`,
    );
  }
}
