ALTER TABLE `dictionaries` ADD `language_id` text;
--> statement-breakpoint
ALTER TABLE `dictionaries` ADD `slug` text;
--> statement-breakpoint
ALTER TABLE `dictionaries` ADD `source_type` text;
--> statement-breakpoint
ALTER TABLE `dictionaries` ADD `source_url` text;
--> statement-breakpoint
ALTER TABLE `dictionaries` ADD `version_tag` text;
--> statement-breakpoint
ALTER TABLE `dictionaries` ADD `dict_date` text;
--> statement-breakpoint
ALTER TABLE `dictionaries` ADD `license` text;
--> statement-breakpoint
ALTER TABLE `dictionaries` ADD `seed_module` text;
--> statement-breakpoint
ALTER TABLE `knowledge` ADD `entry_id` text;
--> statement-breakpoint
CREATE TABLE `languages` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`default_gloss_language` text,
	`is_enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);
--> statement-breakpoint
CREATE INDEX `dictionaries_language_idx` ON `dictionaries` (`language_id`);
--> statement-breakpoint
CREATE INDEX `languages_code_idx` ON `languages` (`code`);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`language_id` text NOT NULL,
	`dictionary_id` text,
	`entry_type` text DEFAULT 'word' NOT NULL,
	`canonical_form` text,
	`canonical_reading` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source_entry_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	FOREIGN KEY (`language_id`) REFERENCES `languages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dictionary_id`) REFERENCES `dictionaries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `entries_language_idx` ON `entries` (`language_id`);
--> statement-breakpoint
CREATE INDEX `entries_canonical_form_idx` ON `entries` (`canonical_form`);
--> statement-breakpoint
CREATE TABLE `entry_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`text` text NOT NULL,
	`script` text,
	`form_type` text DEFAULT 'headword' NOT NULL,
	`is_primary` integer DEFAULT false,
	`is_common` integer DEFAULT false,
	`applies_to_reading` text,
	`raw_rank` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_forms_entry_idx` ON `entry_forms` (`entry_id`);
--> statement-breakpoint
CREATE INDEX `entry_forms_text_idx` ON `entry_forms` (`text`);
--> statement-breakpoint
CREATE TABLE `entry_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`text` text NOT NULL,
	`system` text,
	`script` text,
	`is_primary` integer DEFAULT false,
	`is_common` integer DEFAULT false,
	`raw_rank` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_readings_entry_idx` ON `entry_readings` (`entry_id`);
--> statement-breakpoint
CREATE INDEX `entry_readings_text_idx` ON `entry_readings` (`text`);
--> statement-breakpoint
CREATE TABLE `entry_senses` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`sense_order` integer NOT NULL,
	`part_of_speech` text,
	`register` text,
	`domain` text,
	`dialect` text,
	`info` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_senses_entry_idx` ON `entry_senses` (`entry_id`);
--> statement-breakpoint
CREATE TABLE `sense_glosses` (
	`id` text PRIMARY KEY NOT NULL,
	`sense_id` text NOT NULL,
	`gloss_language` text NOT NULL,
	`gloss_order` integer NOT NULL,
	`text` text NOT NULL,
	`gender` text,
	`gloss_type` text,
	FOREIGN KEY (`sense_id`) REFERENCES `entry_senses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sense_glosses_sense_idx` ON `sense_glosses` (`sense_id`);
--> statement-breakpoint
CREATE INDEX `sense_glosses_text_idx` ON `sense_glosses` (`text`);
--> statement-breakpoint
CREATE TABLE `entry_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`related_entry_id` text NOT NULL,
	`relation_type` text NOT NULL,
	`relation_order` integer,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`related_entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_relations_entry_idx` ON `entry_relations` (`entry_id`);
--> statement-breakpoint
CREATE TABLE `examples` (
	`id` text PRIMARY KEY NOT NULL,
	`language_id` text NOT NULL,
	`text` text NOT NULL,
	`text_normalized` text,
	`translation_group_id` text,
	`source_type` text,
	`source_ref` text,
	`difficulty_band` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	FOREIGN KEY (`language_id`) REFERENCES `languages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `examples_language_idx` ON `examples` (`language_id`);
--> statement-breakpoint
CREATE INDEX `examples_text_idx` ON `examples` (`text`);
--> statement-breakpoint
CREATE TABLE `example_translations` (
	`id` text PRIMARY KEY NOT NULL,
	`example_id` text NOT NULL,
	`language_code` text NOT NULL,
	`text` text NOT NULL,
	`translation_order` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`example_id`) REFERENCES `examples`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `example_translations_example_idx` ON `example_translations` (`example_id`);
--> statement-breakpoint
CREATE TABLE `entry_examples` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`sense_id` text,
	`example_id` text NOT NULL,
	`relation_type` text DEFAULT 'example' NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sense_id`) REFERENCES `entry_senses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`example_id`) REFERENCES `examples`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entry_examples_entry_idx` ON `entry_examples` (`entry_id`);
--> statement-breakpoint
CREATE TABLE `zh_entry_data` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`hsk` text,
	`frequency_rank` integer,
	`variant_rank` integer,
	`decomposition_data` text,
	`classifier_info` text,
	`stroke_asset_id` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `zh_character_data` (
	`character` text PRIMARY KEY NOT NULL,
	`decomposition_data` text,
	`frequency_rank` integer,
	`hsk` text,
	`svg_simplified` text,
	`svg_traditional` text,
	`svg_special` text
);
--> statement-breakpoint
CREATE TABLE `ja_entry_data` (
	`entry_id` text PRIMARY KEY NOT NULL,
	`jlpt` text,
	`is_common` integer DEFAULT false,
	`priority_tags` text,
	`name_type` text,
	`kanjidic_character_refs` text,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ja_character_data` (
	`character` text PRIMARY KEY NOT NULL,
	`grade` integer,
	`stroke_counts` text,
	`frequency` integer,
	`jlpt` text,
	`radical_classical` integer,
	`radical_nelson` integer,
	`readings_json` text,
	`meanings_json` text
);
--> statement-breakpoint
CREATE TABLE `ja_character_components` (
	`id` text PRIMARY KEY NOT NULL,
	`character` text NOT NULL,
	`component` text NOT NULL,
	`component_order` integer
);
--> statement-breakpoint
CREATE INDEX `ja_character_components_character_idx` ON `ja_character_components` (`character`);
--> statement-breakpoint
CREATE TABLE `ja_radicals` (
	`radical` text PRIMARY KEY NOT NULL,
	`stroke_count` integer,
	`code` text
);
--> statement-breakpoint
CREATE TABLE `ja_radical_characters` (
	`id` text PRIMARY KEY NOT NULL,
	`radical` text NOT NULL,
	`character` text NOT NULL,
	FOREIGN KEY (`radical`) REFERENCES `ja_radicals`(`radical`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ja_radical_characters_radical_idx` ON `ja_radical_characters` (`radical`);
