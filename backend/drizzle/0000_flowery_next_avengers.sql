CREATE TABLE "sync_cards" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"deck_id" text NOT NULL,
	"knowledge_id" text NOT NULL,
	"note" text,
	"tags" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_cards_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
--> statement-breakpoint
CREATE TABLE "sync_deck_folders" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_deck_folders_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
--> statement-breakpoint
CREATE TABLE "sync_decks" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"visibility" text DEFAULT 'Private' NOT NULL,
	"is_starred" boolean DEFAULT false NOT NULL,
	"folder_id" text,
	"language_id" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_decks_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
--> statement-breakpoint
CREATE TABLE "sync_devices" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"platform" text,
	"app_version" text,
	"sync_mode" text DEFAULT 'manual' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_pushed_at" timestamp with time zone,
	"last_pulled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_devices_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
CREATE TABLE "sync_knowledge" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"front" text NOT NULL,
	"definitions" text NOT NULL,
	"pronunciation" text,
	"word_id" text,
	"entry_id" text,
	"focus" text,
	"show_focus" boolean DEFAULT false NOT NULL,
	"focus_allows_duplicates" boolean DEFAULT true NOT NULL,
	"note" text,
	"tags" text,
	"config_signature" text DEFAULT '__all__' NOT NULL,
	"definition_config" jsonb,
	"config_label" text,
	"due" timestamp with time zone NOT NULL,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"elapsed_days" double precision DEFAULT 0 NOT NULL,
	"scheduled_days" double precision DEFAULT 0 NOT NULL,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'New' NOT NULL,
	"last_review" timestamp with time zone NOT NULL,
	"review_type" text DEFAULT 'Front-Back' NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_knowledge_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
--> statement-breakpoint
CREATE TABLE "sync_review_logs" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"knowledge_id" text NOT NULL,
	"rating" text,
	"review" timestamp with time zone NOT NULL,
	"due" timestamp with time zone NOT NULL,
	"stability" double precision DEFAULT 0 NOT NULL,
	"difficulty" double precision DEFAULT 0 NOT NULL,
	"elapsed_days" double precision DEFAULT 0 NOT NULL,
	"scheduled_days" double precision DEFAULT 0 NOT NULL,
	"learning_steps" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'New' NOT NULL,
	"last_elapsed_days" double precision DEFAULT 0 NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_review_logs_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
--> statement-breakpoint
CREATE TABLE "sync_users" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_cards" ADD CONSTRAINT "sync_cards_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."sync_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cards" ADD CONSTRAINT "sync_cards_deck_fk" FOREIGN KEY ("owner_id","deck_id") REFERENCES "public"."sync_decks"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_cards" ADD CONSTRAINT "sync_cards_knowledge_fk" FOREIGN KEY ("owner_id","knowledge_id") REFERENCES "public"."sync_knowledge"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_deck_folders" ADD CONSTRAINT "sync_deck_folders_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."sync_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_deck_folders" ADD CONSTRAINT "sync_deck_folders_parent_fk" FOREIGN KEY ("owner_id","parent_id") REFERENCES "public"."sync_deck_folders"("owner_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_decks" ADD CONSTRAINT "sync_decks_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."sync_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_decks" ADD CONSTRAINT "sync_decks_folder_fk" FOREIGN KEY ("owner_id","folder_id") REFERENCES "public"."sync_deck_folders"("owner_id","id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_devices" ADD CONSTRAINT "sync_devices_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."sync_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_knowledge" ADD CONSTRAINT "sync_knowledge_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."sync_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_review_logs" ADD CONSTRAINT "sync_review_logs_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."sync_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_review_logs" ADD CONSTRAINT "sync_review_logs_knowledge_fk" FOREIGN KEY ("owner_id","knowledge_id") REFERENCES "public"."sync_knowledge"("owner_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_cards_owner_server_idx" ON "sync_cards" USING btree ("owner_id","server_updated_at");--> statement-breakpoint
CREATE INDEX "sync_cards_owner_deck_idx" ON "sync_cards" USING btree ("owner_id","deck_id");--> statement-breakpoint
CREATE INDEX "sync_deck_folders_owner_server_idx" ON "sync_deck_folders" USING btree ("owner_id","server_updated_at");--> statement-breakpoint
CREATE INDEX "sync_decks_owner_language_idx" ON "sync_decks" USING btree ("owner_id","language_id");--> statement-breakpoint
CREATE INDEX "sync_decks_owner_server_idx" ON "sync_decks" USING btree ("owner_id","server_updated_at");--> statement-breakpoint
CREATE INDEX "sync_knowledge_owner_server_idx" ON "sync_knowledge" USING btree ("owner_id","server_updated_at");--> statement-breakpoint
CREATE INDEX "sync_knowledge_owner_entry_idx" ON "sync_knowledge" USING btree ("owner_id","entry_id","review_type","config_signature");--> statement-breakpoint
CREATE INDEX "sync_review_logs_owner_server_idx" ON "sync_review_logs" USING btree ("owner_id","server_updated_at");--> statement-breakpoint
CREATE INDEX "sync_review_logs_owner_knowledge_idx" ON "sync_review_logs" USING btree ("owner_id","knowledge_id","review");