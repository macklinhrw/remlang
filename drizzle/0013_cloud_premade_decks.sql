CREATE TABLE `premade_decks` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`book` text NOT NULL,
	`lesson` integer NOT NULL,
	`language_id` text NOT NULL,
	`source` text NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `premade_decks_slug_idx` ON `premade_decks` (`slug`);
--> statement-breakpoint
CREATE INDEX `premade_decks_language_idx` ON `premade_decks` (`language_id`);
--> statement-breakpoint
CREATE TABLE `premade_items` (
	`id` text PRIMARY KEY NOT NULL,
	`premade_deck_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`source_tag` text NOT NULL,
	`kana` text,
	`kanji` text,
	`english` text NOT NULL,
	`front` text NOT NULL,
	`pronunciation` text,
	`source_definitions` text NOT NULL,
	`dictionary_entry_id` text,
	`dictionary_sense_ids` text NOT NULL,
	`uses_all_senses` integer DEFAULT false NOT NULL,
	`match_status` text,
	`match_method` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`premade_deck_id`) REFERENCES `premade_decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `premade_items_deck_sort_idx` ON `premade_items` (`premade_deck_id`, `sort_order`);
--> statement-breakpoint
CREATE INDEX `premade_items_entry_idx` ON `premade_items` (`dictionary_entry_id`);
--> statement-breakpoint
CREATE TABLE `premade_sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`last_pulled_at` text,
	`last_cursor` text,
	`last_successful_sync_at` text,
	`last_error` text
);
