ALTER TABLE "sync_deck_folders" ADD COLUMN "language_id" text;
CREATE INDEX "sync_deck_folders_owner_language_idx" ON "sync_deck_folders" ("owner_id","language_id");
