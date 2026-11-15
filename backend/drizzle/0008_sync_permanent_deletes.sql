CREATE TABLE "sync_permanent_deletes" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_permanent_deletes_owner_id_id_pk" PRIMARY KEY("owner_id","id"),
	CONSTRAINT "sync_permanent_deletes_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "sync_users"("id") ON DELETE cascade
);
CREATE INDEX "sync_permanent_deletes_owner_server_idx" ON "sync_permanent_deletes" USING btree ("owner_id","server_updated_at");
CREATE INDEX "sync_permanent_deletes_owner_entity_idx" ON "sync_permanent_deletes" USING btree ("owner_id","entity_type","entity_id");
