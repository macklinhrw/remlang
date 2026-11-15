CREATE TABLE "premade_decks" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "book" text NOT NULL,
  "lesson" integer NOT NULL,
  "language_id" text NOT NULL,
  "source" text NOT NULL,
  "is_published" boolean DEFAULT false NOT NULL,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "server_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "premade_items" (
  "id" text PRIMARY KEY NOT NULL,
  "premade_deck_id" text NOT NULL,
  "sort_order" integer NOT NULL,
  "source_tag" text NOT NULL,
  "kana" text,
  "kanji" text,
  "english" text NOT NULL,
  "front" text NOT NULL,
  "pronunciation" text,
  "source_definitions" text NOT NULL,
  "dictionary_entry_id" text,
  "dictionary_sense_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "uses_all_senses" boolean DEFAULT false NOT NULL,
  "match_status" text,
  "match_method" text,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "server_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "premade_items"
  ADD CONSTRAINT "premade_items_deck_fk"
  FOREIGN KEY ("premade_deck_id")
  REFERENCES "public"."premade_decks"("id")
  ON DELETE cascade
  ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "premade_decks_slug_idx" ON "premade_decks" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "premade_decks_language_idx" ON "premade_decks" USING btree ("language_id");
--> statement-breakpoint
CREATE INDEX "premade_decks_published_idx" ON "premade_decks" USING btree ("is_published");
--> statement-breakpoint
CREATE INDEX "premade_decks_server_idx" ON "premade_decks" USING btree ("server_updated_at");
--> statement-breakpoint
CREATE INDEX "premade_items_deck_sort_idx" ON "premade_items" USING btree ("premade_deck_id","sort_order");
--> statement-breakpoint
CREATE INDEX "premade_items_server_idx" ON "premade_items" USING btree ("server_updated_at");
--> statement-breakpoint
CREATE INDEX "premade_items_entry_idx" ON "premade_items" USING btree ("dictionary_entry_id");
