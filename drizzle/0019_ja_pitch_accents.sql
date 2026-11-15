CREATE TABLE `ja_pitch_accents` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`dictionary_id` text,
	`surface_form` text NOT NULL,
	`reading` text NOT NULL,
	`pronunciation` text,
	`accent_number` integer NOT NULL,
	`accent_order` integer DEFAULT 1 NOT NULL,
	`accent_pattern` text,
	`raw_accent_type` text NOT NULL,
	`raw_accent_con_type` text,
	`raw_accent_mod_type` text,
	`mora_count` integer,
	`source_lexeme_id` text,
	`source_lemma_id` text,
	`source_line` integer,
	`match_type` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dictionary_id`) REFERENCES `dictionaries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ja_pitch_accents_entry_idx` ON `ja_pitch_accents` (`entry_id`);
--> statement-breakpoint
CREATE INDEX `ja_pitch_accents_surface_idx` ON `ja_pitch_accents` (`surface_form`);
--> statement-breakpoint
CREATE INDEX `ja_pitch_accents_reading_idx` ON `ja_pitch_accents` (`reading`);
