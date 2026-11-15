ALTER TABLE `decks` ADD `deleted` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `decks` ADD `deleted_at` text;
--> statement-breakpoint
ALTER TABLE `cards` ADD `deleted` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `cards` ADD `deleted_at` text;
