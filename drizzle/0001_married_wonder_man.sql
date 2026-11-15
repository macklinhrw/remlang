CREATE TABLE `cards` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	`deck_id` text NOT NULL,
	`knowledge_id` text NOT NULL,
	`note` text,
	`tags` text,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`knowledge_id`) REFERENCES `knowledge`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	`visibility` text DEFAULT 'Private' NOT NULL,
	`is_starred` integer DEFAULT false,
	`folder_id` text,
	FOREIGN KEY (`folder_id`) REFERENCES `decks_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `decks_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	`parent_id` text,
	FOREIGN KEY (`parent_id`) REFERENCES `decks_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `example_sentences` (
	`id` text PRIMARY KEY NOT NULL,
	`sentence` text NOT NULL,
	`sentence_translation` text NOT NULL,
	`sentence_traditional` text NOT NULL,
	`sentence_audio` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	`hsk` text,
	`sentence_variant_parent_id` text,
	`is_ai_generated` integer DEFAULT false,
	FOREIGN KEY (`sentence_variant_parent_id`) REFERENCES `example_sentences`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sentence_idx` ON `example_sentences` (`sentence`);--> statement-breakpoint
CREATE TABLE `examples_to_words` (
	`sentence_id` text NOT NULL,
	`word_id` text NOT NULL,
	PRIMARY KEY(`sentence_id`, `word_id`),
	FOREIGN KEY (`sentence_id`) REFERENCES `example_sentences`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `params` (
	`id` text PRIMARY KEY NOT NULL,
	`weights` text DEFAULT '[0.40255,1.18385,3.173,15.69105,7.1949,0.5345,1.4604,0.0046,1.54575,0.1192,1.01925,1.9395,0.11,0.29605,2.2698,0.2315,2.9898,0.51655,0.6621]' NOT NULL,
	`request_retention` real DEFAULT 0.9 NOT NULL,
	`maximum_interval` integer DEFAULT 36500 NOT NULL,
	`enable_fuzz` integer DEFAULT false NOT NULL,
	`enable_short_term` integer DEFAULT true NOT NULL,
	`card_limit` integer DEFAULT 50 NOT NULL,
	`lapses` integer DEFAULT 8 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	`front` text NOT NULL,
	`definitions` text NOT NULL,
	`pronunciation` text,
	`word_id` text,
	`focus` text,
	`show_focus` integer DEFAULT false,
	`focus_allows_duplicates` integer DEFAULT true,
	`note` text,
	`tags` text,
	`due` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')) NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`elapsed_days` real DEFAULT 0 NOT NULL,
	`scheduled_days` real DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`lapses` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'New' NOT NULL,
	`last_review` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')) NOT NULL,
	`review_type` text DEFAULT 'Front-Back' NOT NULL,
	`deleted` integer DEFAULT false,
	`suspended` integer DEFAULT false,
	FOREIGN KEY (`word_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `review_log` (
	`id` text PRIMARY KEY NOT NULL,
	`rating` text,
	`knowledge_id` text,
	`review` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')) NOT NULL,
	`due` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')) NOT NULL,
	`stability` real DEFAULT 0 NOT NULL,
	`difficulty` real DEFAULT 0 NOT NULL,
	`elapsed_days` real DEFAULT 0 NOT NULL,
	`scheduled_days` real DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'New' NOT NULL,
	`last_elapsed_days` real DEFAULT 0 NOT NULL,
	`deleted` integer DEFAULT false,
	FOREIGN KEY (`knowledge_id`) REFERENCES `knowledge`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `words` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`traditional` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	`dictionary_id` text NOT NULL,
	`definitions` text NOT NULL,
	`frequency_rank` integer,
	`variant_rank` integer,
	`hsk` text,
	`pronunciation` text,
	`variant_parent_id` text,
	`decomposition_data` text,
	FOREIGN KEY (`dictionary_id`) REFERENCES `dictionaries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`variant_parent_id`) REFERENCES `words`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `name_idx` ON `words` (`name`);