ALTER TABLE `decks` ADD `source_review_type` text;
--> statement-breakpoint
ALTER TABLE `decks` ADD `primary_deck_id` text;
--> statement-breakpoint
CREATE INDEX `decks_primary_deck_idx` ON `decks` (`primary_deck_id`);
--> statement-breakpoint
CREATE TABLE `deck_links` (
	`id` text PRIMARY KEY NOT NULL,
	`primary_deck_id` text NOT NULL,
	`linked_deck_id` text NOT NULL,
	`target_review_type` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	FOREIGN KEY (`primary_deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linked_deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deck_links_primary_deck_idx` ON `deck_links` (`primary_deck_id`);
--> statement-breakpoint
CREATE INDEX `deck_links_linked_deck_idx` ON `deck_links` (`linked_deck_id`);
--> statement-breakpoint
CREATE TABLE `knowledge_links` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_link_id` text NOT NULL,
	`source_knowledge_id` text NOT NULL,
	`mirrored_knowledge_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	FOREIGN KEY (`deck_link_id`) REFERENCES `deck_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_knowledge_id`) REFERENCES `knowledge`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mirrored_knowledge_id`) REFERENCES `knowledge`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `knowledge_links_deck_link_idx` ON `knowledge_links` (`deck_link_id`);
--> statement-breakpoint
CREATE INDEX `knowledge_links_source_knowledge_idx` ON `knowledge_links` (`source_knowledge_id`);
--> statement-breakpoint
CREATE INDEX `knowledge_links_mirrored_knowledge_idx` ON `knowledge_links` (`mirrored_knowledge_id`);
--> statement-breakpoint
CREATE TABLE `card_links` (
	`id` text PRIMARY KEY NOT NULL,
	`deck_link_id` text NOT NULL,
	`source_card_id` text NOT NULL,
	`mirrored_card_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
	`updated_at` text,
	FOREIGN KEY (`deck_link_id`) REFERENCES `deck_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mirrored_card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `card_links_deck_link_idx` ON `card_links` (`deck_link_id`);
--> statement-breakpoint
CREATE INDEX `card_links_source_card_idx` ON `card_links` (`source_card_id`);
--> statement-breakpoint
CREATE INDEX `card_links_mirrored_card_idx` ON `card_links` (`mirrored_card_id`);
