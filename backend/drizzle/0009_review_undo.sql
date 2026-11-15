CREATE TABLE "sync_review_undos" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"knowledge_id" text NOT NULL,
	"review_log_id" text NOT NULL,
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
	"undone" boolean DEFAULT false NOT NULL,
	"invalidated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_review_undos_owner_id_id_pk" PRIMARY KEY("owner_id","id"),
	CONSTRAINT "sync_review_undos_owner_fk" FOREIGN KEY ("owner_id") REFERENCES "sync_users"("id") ON DELETE cascade,
	CONSTRAINT "sync_review_undos_knowledge_fk" FOREIGN KEY ("owner_id","knowledge_id") REFERENCES "sync_knowledge"("owner_id","id") ON DELETE cascade,
	CONSTRAINT "sync_review_undos_review_log_fk" FOREIGN KEY ("owner_id","review_log_id") REFERENCES "sync_review_logs"("owner_id","id") ON DELETE cascade
);
CREATE INDEX "sync_review_undos_owner_server_idx" ON "sync_review_undos" USING btree ("owner_id","server_updated_at");
CREATE INDEX "sync_review_undos_owner_knowledge_idx" ON "sync_review_undos" USING btree ("owner_id","knowledge_id","created_at");
