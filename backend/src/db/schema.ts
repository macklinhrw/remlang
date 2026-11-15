import {
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const time = (name: string) => timestamp(name, { withTimezone: true });

export const syncUsers = pgTable("sync_users", {
  id: text("id").primaryKey(),
  createdAt: time("created_at").defaultNow().notNull(),
  updatedAt: time("updated_at").defaultNow().notNull(),
});

export const syncDevices = pgTable(
  "sync_devices",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    platform: text("platform"),
    appVersion: text("app_version"),
    syncMode: text("sync_mode").default("manual").notNull(),
    lastSeenAt: time("last_seen_at"),
    lastPushedAt: time("last_pushed_at"),
    lastPulledAt: time("last_pulled_at"),
    createdAt: time("created_at").defaultNow().notNull(),
    updatedAt: time("updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.id] }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [syncUsers.id],
      name: "sync_devices_user_fk",
    }).onDelete("cascade"),
  ],
);

export const syncDeckFolders = pgTable(
  "sync_deck_folders",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    languageId: text("language_id"),
    parentId: text("parent_id"),
    newCardsPaused: boolean("new_cards_paused").default(false).notNull(),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
    deletedAt: time("deleted_at"),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [syncUsers.id],
      name: "sync_deck_folders_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.parentId],
      foreignColumns: [table.ownerId, table.id],
      name: "sync_deck_folders_parent_fk",
    }).onDelete("set null"),
    index("sync_deck_folders_owner_server_idx").on(
      table.ownerId,
      table.serverUpdatedAt,
    ),
    index("sync_deck_folders_owner_language_idx").on(
      table.ownerId,
      table.languageId,
    ),
  ],
);

export const syncDecks = pgTable(
  "sync_decks",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    name: text("name").notNull(),
    visibility: text("visibility").default("Private").notNull(),
    isStarred: boolean("is_starred").default(false).notNull(),
    folderId: text("folder_id"),
    languageId: text("language_id"),
    sourceReviewType: text("source_review_type"),
    primaryDeckId: text("primary_deck_id"),
    newCardsPaused: boolean("new_cards_paused").default(false).notNull(),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
    deletedAt: time("deleted_at"),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [syncUsers.id],
      name: "sync_decks_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.folderId],
      foreignColumns: [syncDeckFolders.ownerId, syncDeckFolders.id],
      name: "sync_decks_folder_fk",
    }).onDelete("set null"),
    foreignKey({
      columns: [table.ownerId, table.primaryDeckId],
      foreignColumns: [table.ownerId, table.id],
      name: "sync_decks_primary_deck_fk",
    }).onDelete("cascade"),
    index("sync_decks_owner_language_idx").on(table.ownerId, table.languageId),
    index("sync_decks_owner_server_idx").on(table.ownerId, table.serverUpdatedAt),
    index("sync_decks_owner_primary_idx").on(table.ownerId, table.primaryDeckId),
  ],
);

export const syncDeckLinks = pgTable(
  "sync_deck_links",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    primaryDeckId: text("primary_deck_id").notNull(),
    linkedDeckId: text("linked_deck_id").notNull(),
    targetReviewType: text("target_review_type").notNull(),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [syncUsers.id],
      name: "sync_deck_links_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.primaryDeckId],
      foreignColumns: [syncDecks.ownerId, syncDecks.id],
      name: "sync_deck_links_primary_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.linkedDeckId],
      foreignColumns: [syncDecks.ownerId, syncDecks.id],
      name: "sync_deck_links_linked_fk",
    }).onDelete("cascade"),
    index("sync_deck_links_owner_server_idx").on(
      table.ownerId,
      table.serverUpdatedAt,
    ),
    index("sync_deck_links_owner_primary_idx").on(table.ownerId, table.primaryDeckId),
    index("sync_deck_links_owner_linked_idx").on(table.ownerId, table.linkedDeckId),
  ],
);

export const syncAppSettings = pgTable(
  "sync_app_settings",
  {
    ownerId: text("owner_id").notNull(),
    key: text("key").notNull(),
    value: text("value"),
    updatedAt: time("updated_at"),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.key] }),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [syncUsers.id],
      name: "sync_app_settings_owner_fk",
    }).onDelete("cascade"),
    index("sync_app_settings_owner_server_idx").on(
      table.ownerId,
      table.serverUpdatedAt,
    ),
  ],
);

export const syncPermanentDeletes = pgTable(
  "sync_permanent_deletes",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    deletedAt: time("deleted_at").notNull(),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [syncUsers.id],
      name: "sync_permanent_deletes_owner_fk",
    }).onDelete("cascade"),
    index("sync_permanent_deletes_owner_server_idx").on(
      table.ownerId,
      table.serverUpdatedAt,
    ),
    index("sync_permanent_deletes_owner_entity_idx").on(
      table.ownerId,
      table.entityType,
      table.entityId,
    ),
  ],
);

export const syncKnowledge = pgTable(
  "sync_knowledge",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    front: text("front").notNull(),
    definitions: text("definitions").notNull(),
    sourceDefinitions: text("source_definitions"),
    pronunciation: text("pronunciation"),
    wordId: text("word_id"),
    entryId: text("entry_id"),
    focus: text("focus"),
    showFocus: boolean("show_focus").default(false).notNull(),
    focusAllowsDuplicates: boolean("focus_allows_duplicates")
      .default(true)
      .notNull(),
    note: text("note"),
    tags: text("tags"),
    primaryPitchAccentDictionaryId: text("primary_pitch_accent_dictionary_id"),
    primaryPitchAccentReading: text("primary_pitch_accent_reading"),
    primaryPitchAccentAccentNumber: integer("primary_pitch_accent_accent_number"),
    primaryPitchAccentIsCustom: boolean("primary_pitch_accent_is_custom"),
    configSignature: text("config_signature").default("__all__").notNull(),
    definitionConfig: jsonb("definition_config").$type<Record<string, unknown> | null>(),
    configLabel: text("config_label"),
    due: time("due").notNull(),
    stability: doublePrecision("stability").default(0).notNull(),
    difficulty: doublePrecision("difficulty").default(0).notNull(),
    elapsedDays: doublePrecision("elapsed_days").default(0).notNull(),
    scheduledDays: doublePrecision("scheduled_days").default(0).notNull(),
    learningSteps: integer("learning_steps").default(0).notNull(),
    reps: integer("reps").default(0).notNull(),
    lapses: integer("lapses").default(0).notNull(),
    state: text("state").default("New").notNull(),
    lastReview: time("last_review").notNull(),
    reviewType: text("review_type").default("Front-Back").notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    suspended: boolean("suspended").default(false).notNull(),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
    deletedAt: time("deleted_at"),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [syncUsers.id],
      name: "sync_knowledge_owner_fk",
    }).onDelete("cascade"),
    index("sync_knowledge_owner_server_idx").on(
      table.ownerId,
      table.serverUpdatedAt,
    ),
    index("sync_knowledge_owner_entry_idx").on(
      table.ownerId,
      table.entryId,
      table.reviewType,
      table.configSignature,
    ),
  ],
);

export const syncCards = pgTable(
  "sync_cards",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    deckId: text("deck_id").notNull(),
    knowledgeId: text("knowledge_id").notNull(),
    note: text("note"),
    tags: text("tags"),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
    deletedAt: time("deleted_at"),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [syncUsers.id],
      name: "sync_cards_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.deckId],
      foreignColumns: [syncDecks.ownerId, syncDecks.id],
      name: "sync_cards_deck_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.knowledgeId],
      foreignColumns: [syncKnowledge.ownerId, syncKnowledge.id],
      name: "sync_cards_knowledge_fk",
    }).onDelete("cascade"),
    index("sync_cards_owner_server_idx").on(table.ownerId, table.serverUpdatedAt),
    index("sync_cards_owner_deck_idx").on(table.ownerId, table.deckId),
  ],
);

export const syncKnowledgeLinks = pgTable(
  "sync_knowledge_links",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    deckLinkId: text("deck_link_id").notNull(),
    sourceKnowledgeId: text("source_knowledge_id").notNull(),
    mirroredKnowledgeId: text("mirrored_knowledge_id").notNull(),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [syncUsers.id],
      name: "sync_knowledge_links_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.deckLinkId],
      foreignColumns: [syncDeckLinks.ownerId, syncDeckLinks.id],
      name: "sync_knowledge_links_deck_link_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.sourceKnowledgeId],
      foreignColumns: [syncKnowledge.ownerId, syncKnowledge.id],
      name: "sync_knowledge_links_source_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.mirroredKnowledgeId],
      foreignColumns: [syncKnowledge.ownerId, syncKnowledge.id],
      name: "sync_knowledge_links_mirrored_fk",
    }).onDelete("cascade"),
    index("sync_knowledge_links_owner_server_idx").on(
      table.ownerId,
      table.serverUpdatedAt,
    ),
    index("sync_knowledge_links_owner_deck_link_idx").on(
      table.ownerId,
      table.deckLinkId,
    ),
  ],
);

export const syncCardLinks = pgTable(
  "sync_card_links",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    deckLinkId: text("deck_link_id").notNull(),
    sourceCardId: text("source_card_id").notNull(),
    mirroredCardId: text("mirrored_card_id").notNull(),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [syncUsers.id],
      name: "sync_card_links_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.deckLinkId],
      foreignColumns: [syncDeckLinks.ownerId, syncDeckLinks.id],
      name: "sync_card_links_deck_link_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.sourceCardId],
      foreignColumns: [syncCards.ownerId, syncCards.id],
      name: "sync_card_links_source_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.mirroredCardId],
      foreignColumns: [syncCards.ownerId, syncCards.id],
      name: "sync_card_links_mirrored_fk",
    }).onDelete("cascade"),
    index("sync_card_links_owner_server_idx").on(
      table.ownerId,
      table.serverUpdatedAt,
    ),
    index("sync_card_links_owner_deck_link_idx").on(table.ownerId, table.deckLinkId),
  ],
);

export const syncReviewLogs = pgTable(
  "sync_review_logs",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    knowledgeId: text("knowledge_id").notNull(),
    rating: text("rating"),
    review: time("review").notNull(),
    due: time("due").notNull(),
    stability: doublePrecision("stability").default(0).notNull(),
    difficulty: doublePrecision("difficulty").default(0).notNull(),
    elapsedDays: doublePrecision("elapsed_days").default(0).notNull(),
    scheduledDays: doublePrecision("scheduled_days").default(0).notNull(),
    learningSteps: integer("learning_steps").default(0).notNull(),
    state: text("state").default("New").notNull(),
    lastElapsedDays: doublePrecision("last_elapsed_days").default(0).notNull(),
    durationMs: integer("duration_ms"),
    deleted: boolean("deleted").default(false).notNull(),
    createdAt: time("created_at").defaultNow().notNull(),
    updatedAt: time("updated_at"),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [syncUsers.id],
      name: "sync_review_logs_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.knowledgeId],
      foreignColumns: [syncKnowledge.ownerId, syncKnowledge.id],
      name: "sync_review_logs_knowledge_fk",
    }).onDelete("cascade"),
    index("sync_review_logs_owner_server_idx").on(
      table.ownerId,
      table.serverUpdatedAt,
    ),
    index("sync_review_logs_owner_knowledge_idx").on(
      table.ownerId,
      table.knowledgeId,
      table.review,
    ),
  ],
);

export const syncReviewUndos = pgTable(
  "sync_review_undos",
  {
    ownerId: text("owner_id").notNull(),
    id: text("id").notNull(),
    knowledgeId: text("knowledge_id").notNull(),
    reviewLogId: text("review_log_id").notNull(),
    due: time("due").notNull(),
    stability: doublePrecision("stability").default(0).notNull(),
    difficulty: doublePrecision("difficulty").default(0).notNull(),
    elapsedDays: doublePrecision("elapsed_days").default(0).notNull(),
    scheduledDays: doublePrecision("scheduled_days").default(0).notNull(),
    learningSteps: integer("learning_steps").default(0).notNull(),
    reps: integer("reps").default(0).notNull(),
    lapses: integer("lapses").default(0).notNull(),
    state: text("state").default("New").notNull(),
    lastReview: time("last_review").notNull(),
    undone: boolean("undone").default(false).notNull(),
    invalidated: boolean("invalidated").default(false).notNull(),
    createdAt: time("created_at").defaultNow().notNull(),
    updatedAt: time("updated_at"),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.id] }),
    foreignKey({
      columns: [table.ownerId],
      foreignColumns: [syncUsers.id],
      name: "sync_review_undos_owner_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.knowledgeId],
      foreignColumns: [syncKnowledge.ownerId, syncKnowledge.id],
      name: "sync_review_undos_knowledge_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.ownerId, table.reviewLogId],
      foreignColumns: [syncReviewLogs.ownerId, syncReviewLogs.id],
      name: "sync_review_undos_review_log_fk",
    }).onDelete("cascade"),
    index("sync_review_undos_owner_server_idx").on(
      table.ownerId,
      table.serverUpdatedAt,
    ),
    index("sync_review_undos_owner_knowledge_idx").on(
      table.ownerId,
      table.knowledgeId,
      table.createdAt,
    ),
  ],
);

export const premadeDecks = pgTable(
  "premade_decks",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    book: text("book").notNull(),
    lesson: integer("lesson").notNull(),
    languageId: text("language_id").notNull(),
    source: text("source").notNull(),
    isPublished: boolean("is_published").default(false).notNull(),
    deletedAt: time("deleted_at"),
    createdAt: time("created_at").defaultNow().notNull(),
    updatedAt: time("updated_at").defaultNow().notNull(),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("premade_decks_slug_idx").on(table.slug),
    index("premade_decks_language_idx").on(table.languageId),
    index("premade_decks_published_idx").on(table.isPublished),
    index("premade_decks_server_idx").on(table.serverUpdatedAt),
  ],
);

export const premadeItems = pgTable(
  "premade_items",
  {
    id: text("id").primaryKey(),
    premadeDeckId: text("premade_deck_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    sourceTag: text("source_tag").notNull(),
    kana: text("kana"),
    kanji: text("kanji"),
    english: text("english").notNull(),
    front: text("front").notNull(),
    pronunciation: text("pronunciation"),
    sourceDefinitions: text("source_definitions").notNull(),
    dictionaryEntryId: text("dictionary_entry_id"),
    dictionarySenseIds: jsonb("dictionary_sense_ids").$type<string[]>().default([]).notNull(),
    usesAllSenses: boolean("uses_all_senses").default(false).notNull(),
    matchStatus: text("match_status"),
    matchMethod: text("match_method"),
    deletedAt: time("deleted_at"),
    createdAt: time("created_at").defaultNow().notNull(),
    updatedAt: time("updated_at").defaultNow().notNull(),
    serverUpdatedAt: time("server_updated_at").defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.premadeDeckId],
      foreignColumns: [premadeDecks.id],
      name: "premade_items_deck_fk",
    }).onDelete("cascade"),
    index("premade_items_deck_sort_idx").on(table.premadeDeckId, table.sortOrder),
    index("premade_items_server_idx").on(table.serverUpdatedAt),
    index("premade_items_entry_idx").on(table.dictionaryEntryId),
  ],
);
