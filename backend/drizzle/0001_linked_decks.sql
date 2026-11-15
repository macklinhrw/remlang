ALTER TABLE "sync_decks" ADD COLUMN "source_review_type" text;
--> statement-breakpoint
ALTER TABLE "sync_decks" ADD COLUMN "primary_deck_id" text;
--> statement-breakpoint
ALTER TABLE "sync_decks" ADD CONSTRAINT "sync_decks_primary_deck_fk" FOREIGN KEY ("owner_id","primary_deck_id") REFERENCES "public"."sync_decks"("owner_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sync_decks_owner_primary_idx" ON "sync_decks" USING btree ("owner_id","primary_deck_id");
--> statement-breakpoint
CREATE TABLE "sync_deck_links" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"primary_deck_id" text NOT NULL,
	"linked_deck_id" text NOT NULL,
	"target_review_type" text NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_deck_links_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
--> statement-breakpoint
ALTER TABLE "sync_deck_links" ADD CONSTRAINT "sync_deck_links_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."sync_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_deck_links" ADD CONSTRAINT "sync_deck_links_primary_fk" FOREIGN KEY ("owner_id","primary_deck_id") REFERENCES "public"."sync_decks"("owner_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_deck_links" ADD CONSTRAINT "sync_deck_links_linked_fk" FOREIGN KEY ("owner_id","linked_deck_id") REFERENCES "public"."sync_decks"("owner_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sync_deck_links_owner_server_idx" ON "sync_deck_links" USING btree ("owner_id","server_updated_at");
--> statement-breakpoint
CREATE INDEX "sync_deck_links_owner_primary_idx" ON "sync_deck_links" USING btree ("owner_id","primary_deck_id");
--> statement-breakpoint
CREATE INDEX "sync_deck_links_owner_linked_idx" ON "sync_deck_links" USING btree ("owner_id","linked_deck_id");
--> statement-breakpoint
CREATE TABLE "sync_knowledge_links" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"deck_link_id" text NOT NULL,
	"source_knowledge_id" text NOT NULL,
	"mirrored_knowledge_id" text NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_knowledge_links_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
--> statement-breakpoint
ALTER TABLE "sync_knowledge_links" ADD CONSTRAINT "sync_knowledge_links_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."sync_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_knowledge_links" ADD CONSTRAINT "sync_knowledge_links_deck_link_fk" FOREIGN KEY ("owner_id","deck_link_id") REFERENCES "public"."sync_deck_links"("owner_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_knowledge_links" ADD CONSTRAINT "sync_knowledge_links_source_fk" FOREIGN KEY ("owner_id","source_knowledge_id") REFERENCES "public"."sync_knowledge"("owner_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_knowledge_links" ADD CONSTRAINT "sync_knowledge_links_mirrored_fk" FOREIGN KEY ("owner_id","mirrored_knowledge_id") REFERENCES "public"."sync_knowledge"("owner_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sync_knowledge_links_owner_server_idx" ON "sync_knowledge_links" USING btree ("owner_id","server_updated_at");
--> statement-breakpoint
CREATE INDEX "sync_knowledge_links_owner_deck_link_idx" ON "sync_knowledge_links" USING btree ("owner_id","deck_link_id");
--> statement-breakpoint
CREATE TABLE "sync_card_links" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"deck_link_id" text NOT NULL,
	"source_card_id" text NOT NULL,
	"mirrored_card_id" text NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_card_links_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
--> statement-breakpoint
ALTER TABLE "sync_card_links" ADD CONSTRAINT "sync_card_links_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."sync_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_card_links" ADD CONSTRAINT "sync_card_links_deck_link_fk" FOREIGN KEY ("owner_id","deck_link_id") REFERENCES "public"."sync_deck_links"("owner_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_card_links" ADD CONSTRAINT "sync_card_links_source_fk" FOREIGN KEY ("owner_id","source_card_id") REFERENCES "public"."sync_cards"("owner_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_card_links" ADD CONSTRAINT "sync_card_links_mirrored_fk" FOREIGN KEY ("owner_id","mirrored_card_id") REFERENCES "public"."sync_cards"("owner_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "sync_card_links_owner_server_idx" ON "sync_card_links" USING btree ("owner_id","server_updated_at");
--> statement-breakpoint
CREATE INDEX "sync_card_links_owner_deck_link_idx" ON "sync_card_links" USING btree ("owner_id","deck_link_id");
