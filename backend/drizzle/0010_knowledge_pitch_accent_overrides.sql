ALTER TABLE "sync_knowledge" ADD COLUMN "primary_pitch_accent_dictionary_id" text;
--> statement-breakpoint
ALTER TABLE "sync_knowledge" ADD COLUMN "primary_pitch_accent_reading" text;
--> statement-breakpoint
ALTER TABLE "sync_knowledge" ADD COLUMN "primary_pitch_accent_accent_number" integer;
--> statement-breakpoint
ALTER TABLE "sync_knowledge" ADD COLUMN "primary_pitch_accent_is_custom" boolean;
