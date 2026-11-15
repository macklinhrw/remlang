import { sql, relations } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  index,
  foreignKey,
} from "drizzle-orm/sqlite-core";
import {
  default_w,
  default_enable_fuzz,
  default_maximum_interval,
  default_request_retention,
  State, // Keep for type hints if needed
  Rating, // Keep for type hints if needed
} from "ts-fsrs"; // Assuming this path is correct

// --- Default Values ---
const default_enable_short_term = 1; // Use 1 for true in SQLite integer boolean
const jsonDefaultWeights = JSON.stringify(default_w); // Keep as string for text column

// --- Languages ---
export const languages = sqliteTable("languages", {
  id: text("id").notNull().primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  defaultGlossLanguage: text("default_gloss_language"),
  isEnabled: integer("is_enabled", { mode: "boolean" }).default(true).notNull(),
  createdAt: text("created_at").default(
    sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
  ),
});

export const languagesRelations = relations(languages, ({ many }) => ({
  dictionaries: many(dictionaries),
  entries: many(entries),
  examples: many(examples),
}));

// --- Dictionaries ---
export const dictionaries = sqliteTable(
  "dictionaries",
  {
    id: text("id").notNull().primaryKey(),
    name: text("name").notNull(),
    languageId: text("language_id"),
    slug: text("slug"),
    sourceType: text("source_type"),
    sourceUrl: text("source_url"),
    versionTag: text("version_tag"),
    dictDate: text("dict_date"),
    license: text("license"),
    seedModule: text("seed_module"),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    index("dictionaries_language_idx").on(table.languageId),
    foreignKey({
      columns: [table.languageId],
      foreignColumns: [languages.id],
    }).onDelete("set null"),
  ],
);

export const dictionaryRelations = relations(dictionaries, ({ many, one }) => ({
  language: one(languages, {
    fields: [dictionaries.languageId],
    references: [languages.id],
  }),
  words: many(words),
  entries: many(entries),
}));

// --- Words ---
export const words = sqliteTable(
  "words",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    traditional: text("traditional"),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    dictionaryId: text("dictionary_id").notNull(),
    definitions: text("definitions").notNull(),
    frequencyRank: integer("frequency_rank"),
    variantRank: integer("variant_rank"),
    hsk: text("hsk"),
    pronunciation: text("pronunciation"),
    variantParentId: text("variant_parent_id"),
    decompositionData: text("decomposition_data"),
    svgSimplified: text("svg_simplified"),
    svgTraditional: text("svg_traditional"),
    svgSpecial: text("svg_special"),
  },
  (table) => [
    index("name_idx").on(table.name),
    foreignKey({
      columns: [table.dictionaryId],
      foreignColumns: [dictionaries.id],
    }),
    foreignKey({
      columns: [table.variantParentId],
      foreignColumns: [table.id],
    }),
  ],
);

export const wordsRelations = relations(words, ({ one, many }) => ({
  dictionary: one(dictionaries, {
    fields: [words.dictionaryId],
    references: [dictionaries.id],
  }),
  knowledge: many(knowledge),
  variantParent: one(words, {
    fields: [words.variantParentId],
    references: [words.id],
    relationName: "variants",
  }),
  variants: many(words, { relationName: "variants" }),
  sentences: many(examplesToWords),
}));

// --- Example Sentences ---
export const exampleSentences = sqliteTable(
  "example_sentences",
  {
    id: text("id").primaryKey().notNull(),
    sentence: text("sentence").notNull(),
    sentenceTranslation: text("sentence_translation").notNull(),
    sentenceTraditional: text("sentence_traditional").notNull(),
    sentenceAudio: text("sentence_audio"), // Store path or identifier
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    hsk: text("hsk"),
    variantParentId: text("sentence_variant_parent_id"),
    isAiGenerated: integer("is_ai_generated", { mode: "boolean" }).default(
      false,
    ), // Use integer for boolean
  },
  (table) => [
    index("sentence_idx").on(table.sentence),
    foreignKey({
      columns: [table.variantParentId],
      foreignColumns: [table.id],
    }),
  ],
);

export const exampleSentencesRelations = relations(
  exampleSentences,
  ({ one, many }) => ({
    variantParent: one(exampleSentences, {
      fields: [exampleSentences.variantParentId],
      references: [exampleSentences.id],
      relationName: "sentence_variants",
    }),
    variants: many(exampleSentences, { relationName: "sentence_variants" }),
    words: many(examplesToWords),
  }),
);

// --- Join Table: Examples to Words ---
export const examplesToWords = sqliteTable(
  "examples_to_words",
  {
    sentenceId: text("sentence_id").notNull(),
    wordId: text("word_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sentenceId, table.wordId] }),
    foreignKey({
      columns: [table.sentenceId],
      foreignColumns: [exampleSentences.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.wordId],
      foreignColumns: [words.id],
    }).onDelete("cascade"),
  ],
);

export const examplesToWordsRelations = relations(
  examplesToWords,
  ({ one }) => ({
    sentence: one(exampleSentences, {
      fields: [examplesToWords.sentenceId],
      references: [exampleSentences.id],
    }),
    word: one(words, {
      fields: [examplesToWords.wordId],
      references: [words.id],
    }),
  }),
);

// --- Decks ---
// Using text for enum types in SQLite
export const VisibilityTypesEnum = [
  "Private",
  "Public",
  "Public-Featured",
  "Official",
  "Official-Featured",
] as const;
export type VisibilityType = (typeof VisibilityTypesEnum)[number];

export const decks = sqliteTable(
  "decks",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    visibility: text("visibility").default("Private").notNull(),
    isStarred: integer("is_starred", { mode: "boolean" }).default(false),
    folderId: text("folder_id"),
    languageId: text("language_id"),
    sourceReviewType: text("source_review_type"),
    primaryDeckId: text("primary_deck_id"),
    newCardsPaused: integer("new_cards_paused", { mode: "boolean" }).default(false),
    dailyNewLimitEnabled: integer("daily_new_limit_enabled", { mode: "boolean" }),
    dailyNewLimit: integer("daily_new_limit"),
    dailyReviewLimitEnabled: integer("daily_review_limit_enabled", { mode: "boolean" }),
    dailyReviewLimit: integer("daily_review_limit"),
    deleted: integer("deleted", { mode: "boolean" }).default(false).notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.folderId],
      foreignColumns: [decksFolders.id],
    }).onDelete("set null"),
    foreignKey({
      columns: [table.languageId],
      foreignColumns: [languages.id],
    }).onDelete("set null"),
    foreignKey({
      columns: [table.primaryDeckId],
      foreignColumns: [table.id],
    }).onDelete("cascade"),
    index("decks_language_idx").on(table.languageId),
    index("decks_primary_deck_idx").on(table.primaryDeckId),
  ],
);

export const decksRelations = relations(decks, ({ one, many }) => ({
  // user relation removed
  cards: many(cards),
  folder: one(decksFolders, {
    fields: [decks.folderId],
    references: [decksFolders.id],
  }),
  language: one(languages, {
    fields: [decks.languageId],
    references: [languages.id],
  }),
}));

// --- Deck Folders ---
export const decksFolders = sqliteTable(
  "decks_folders",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    languageId: text("language_id"),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    parentId: text("parent_id"),
    newCardsPaused: integer("new_cards_paused", { mode: "boolean" }).default(false),
    dailyNewLimitEnabled: integer("daily_new_limit_enabled", { mode: "boolean" }),
    dailyNewLimit: integer("daily_new_limit"),
    dailyReviewLimitEnabled: integer("daily_review_limit_enabled", { mode: "boolean" }),
    dailyReviewLimit: integer("daily_review_limit"),
    deleted: integer("deleted", { mode: "boolean" }).default(false).notNull(),
    deletedAt: text("deleted_at"),
    // userId removed
  },
  (table) => [
    foreignKey({
      columns: [table.languageId],
      foreignColumns: [languages.id],
    }).onDelete("set null"),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete("cascade"),
    index("decks_folders_language_idx").on(table.languageId),
  ],
);

export const decksFoldersRelations = relations(
  decksFolders,
  ({ one, many }) => ({
    // user relation removed
    parentFolder: one(decksFolders, {
      fields: [decksFolders.parentId],
      references: [decksFolders.id],
      relationName: "parent_folder_relation",
    }),
    childFolders: many(decksFolders, {
      relationName: "parent_folder_relation",
    }),
    decks: many(decks),
  }),
);

// --- FSRS Knowledge ---
// Enum values stored as text
export const StateEnum = ["New", "Learning", "Review", "Relearning"] as const;
export type StateType = (typeof StateEnum)[number];

export const ReviewTypeEnum = [
  "Front-Back",
  "Back-Front",
  "Pitch",
  "Stroke",
  "Tone",
  "Listening",
] as const;
export type ReviewType = (typeof ReviewTypeEnum)[number];

export const knowledge = sqliteTable(
  "knowledge",
  {
    id: text("id").primaryKey().notNull(),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    // userId removed
    front: text("front").notNull(),
    definitions: text("definitions").notNull(),
    sourceDefinitions: text("source_definitions"),
    pronunciation: text("pronunciation"),
    wordId: text("word_id"),
    entryId: text("entry_id"),
    focus: text("focus"),
    showFocus: integer("show_focus", { mode: "boolean" }).default(false),
    focusAllowsDuplicates: integer("focus_allows_duplicates", {
      mode: "boolean",
    }).default(true),
    note: text("note"),
    tags: text("tags"),
    primaryPitchAccentDictionaryId: text("primary_pitch_accent_dictionary_id"),
    primaryPitchAccentReading: text("primary_pitch_accent_reading"),
    primaryPitchAccentAccentNumber: integer("primary_pitch_accent_accent_number"),
    primaryPitchAccentIsCustom: integer("primary_pitch_accent_is_custom", {
      mode: "boolean",
    }),
    configSignature: text("config_signature")
      .default("__all__")
      .notNull(),
    definitionConfig: text("definition_config"),
    configLabel: text("config_label"),
    due: text("due")
      .default(sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`)
      .notNull(),
    stability: real("stability").default(0).notNull(),
    difficulty: real("difficulty").default(0).notNull(),
    elapsedDays: real("elapsed_days").default(0).notNull(),
    scheduledDays: real("scheduled_days").default(0).notNull(),
    learningSteps: integer("learning_steps").default(0).notNull(),
    reps: integer("reps").default(0).notNull(),
    lapses: integer("lapses").default(0).notNull(),
    state: text("state").default("New").notNull(),
    lastReview: text("last_review")
      .default(sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`)
      .notNull(),
    reviewType: text("review_type").default("Front-Back").notNull(),
    deleted: integer("deleted", { mode: "boolean" }).default(false),
    suspended: integer("suspended", { mode: "boolean" }).default(false),
  },
  (table) => [
    foreignKey({
      columns: [table.wordId],
      foreignColumns: [words.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.entryId],
      foreignColumns: [entries.id],
    }).onDelete("cascade"),
    index("knowledge_entry_review_config_idx").on(
      table.entryId,
      table.reviewType,
      table.configSignature,
    ),
  ],
);

export const knowledgeRelations = relations(knowledge, ({ many, one }) => ({
  word: one(words, {
    fields: [knowledge.wordId],
    references: [words.id],
  }),
  entry: one(entries, {
    fields: [knowledge.entryId],
    references: [entries.id],
  }),
  cards: many(cards),
  // users relation removed
  reviewLogs: many(reviewLog),
  reviewUndos: many(reviewUndo),
}));

// --- FSRS Review Log ---
// Enum values stored as text
export const RatingEnum = ["Manual", "Again", "Hard", "Good", "Easy"] as const;
export type RatingType = (typeof RatingEnum)[number];

export const reviewLog = sqliteTable(
  "review_log",
  {
    id: text("id").primaryKey().notNull(),
    rating: text("rating"),
    knowledgeId: text("knowledge_id"),
    review: text("review")
      .default(sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`)
      .notNull(),
    due: text("due")
      .default(sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`)
      .notNull(),
    stability: real("stability").default(0).notNull(),
    difficulty: real("difficulty").default(0).notNull(),
    elapsedDays: real("elapsed_days").default(0).notNull(),
    scheduledDays: real("scheduled_days").default(0).notNull(),
    learningSteps: integer("learning_steps").default(0).notNull(),
    state: text("state").default("New").notNull(),
    lastElapsedDays: real("last_elapsed_days").default(0).notNull(),
    durationMs: integer("duration_ms"),
    deleted: integer("deleted", { mode: "boolean" }).default(false),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.knowledgeId],
      foreignColumns: [knowledge.id],
    }).onDelete("cascade"),
  ],
);

export const reviewLogRelations = relations(reviewLog, ({ one }) => ({
  knowledge: one(knowledge, {
    fields: [reviewLog.knowledgeId],
    references: [knowledge.id],
  }),
}));

export const reviewUndo = sqliteTable(
  "review_undo",
  {
    id: text("id").primaryKey().notNull(),
    knowledgeId: text("knowledge_id").notNull(),
    reviewLogId: text("review_log_id").notNull(),
    due: text("due").notNull(),
    stability: real("stability").default(0).notNull(),
    difficulty: real("difficulty").default(0).notNull(),
    elapsedDays: real("elapsed_days").default(0).notNull(),
    scheduledDays: real("scheduled_days").default(0).notNull(),
    learningSteps: integer("learning_steps").default(0).notNull(),
    reps: integer("reps").default(0).notNull(),
    lapses: integer("lapses").default(0).notNull(),
    state: text("state").default("New").notNull(),
    lastReview: text("last_review").notNull(),
    undone: integer("undone", { mode: "boolean" }).default(false).notNull(),
    invalidated: integer("invalidated", { mode: "boolean" }).default(false).notNull(),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.knowledgeId],
      foreignColumns: [knowledge.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.reviewLogId],
      foreignColumns: [reviewLog.id],
    }).onDelete("cascade"),
    index("review_undo_active_idx").on(
      table.invalidated,
      table.undone,
      table.createdAt,
    ),
    index("review_undo_knowledge_idx").on(table.knowledgeId, table.createdAt),
  ],
);

export const reviewUndoRelations = relations(reviewUndo, ({ one }) => ({
  knowledge: one(knowledge, {
    fields: [reviewUndo.knowledgeId],
    references: [knowledge.id],
  }),
  reviewLog: one(reviewLog, {
    fields: [reviewUndo.reviewLogId],
    references: [reviewLog.id],
  }),
}));

// --- Cards (Linking Knowledge to Decks) ---
export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey().notNull(),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    deckId: text("deck_id").notNull(),
    knowledgeId: text("knowledge_id").notNull(),
    note: text("note"),
    tags: text("tags"),
    deleted: integer("deleted", { mode: "boolean" }).default(false).notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.deckId],
      foreignColumns: [decks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.knowledgeId],
      foreignColumns: [knowledge.id],
    }).onDelete("cascade"),
  ],
);

export const cardsRelations = relations(cards, ({ one }) => ({
  deck: one(decks, {
    fields: [cards.deckId],
    references: [decks.id],
  }),
  knowledge: one(knowledge, {
    fields: [cards.knowledgeId],
    references: [knowledge.id],
  }),
  // user relation removed
}));

export const deckLinks = sqliteTable(
  "deck_links",
  {
    id: text("id").primaryKey().notNull(),
    primaryDeckId: text("primary_deck_id").notNull(),
    linkedDeckId: text("linked_deck_id").notNull(),
    targetReviewType: text("target_review_type").notNull(),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.primaryDeckId],
      foreignColumns: [decks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.linkedDeckId],
      foreignColumns: [decks.id],
    }).onDelete("cascade"),
    index("deck_links_primary_deck_idx").on(table.primaryDeckId),
    index("deck_links_linked_deck_idx").on(table.linkedDeckId),
  ],
);

export const knowledgeLinks = sqliteTable(
  "knowledge_links",
  {
    id: text("id").primaryKey().notNull(),
    deckLinkId: text("deck_link_id").notNull(),
    sourceKnowledgeId: text("source_knowledge_id").notNull(),
    mirroredKnowledgeId: text("mirrored_knowledge_id").notNull(),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.deckLinkId],
      foreignColumns: [deckLinks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceKnowledgeId],
      foreignColumns: [knowledge.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.mirroredKnowledgeId],
      foreignColumns: [knowledge.id],
    }).onDelete("cascade"),
    index("knowledge_links_deck_link_idx").on(table.deckLinkId),
    index("knowledge_links_source_knowledge_idx").on(table.sourceKnowledgeId),
    index("knowledge_links_mirrored_knowledge_idx").on(table.mirroredKnowledgeId),
  ],
);

export const cardLinks = sqliteTable(
  "card_links",
  {
    id: text("id").primaryKey().notNull(),
    deckLinkId: text("deck_link_id").notNull(),
    sourceCardId: text("source_card_id").notNull(),
    mirroredCardId: text("mirrored_card_id").notNull(),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    foreignKey({
      columns: [table.deckLinkId],
      foreignColumns: [deckLinks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.sourceCardId],
      foreignColumns: [cards.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.mirroredCardId],
      foreignColumns: [cards.id],
    }).onDelete("cascade"),
    index("card_links_deck_link_idx").on(table.deckLinkId),
    index("card_links_source_card_idx").on(table.sourceCardId),
    index("card_links_mirrored_card_idx").on(table.mirroredCardId),
  ],
);

// --- Multilingual Lexical Core ---
export const EntryTypeEnum = [
  "word",
  "name",
  "character",
  "expression",
] as const;
export type EntryType = (typeof EntryTypeEnum)[number];

export const EntryStatusEnum = ["active", "hidden", "archived"] as const;
export type EntryStatus = (typeof EntryStatusEnum)[number];

export const entries = sqliteTable(
  "entries",
  {
    id: text("id").primaryKey().notNull(),
    languageId: text("language_id").notNull(),
    dictionaryId: text("dictionary_id"),
    entryType: text("entry_type").default("word").notNull(),
    canonicalForm: text("canonical_form"),
    canonicalReading: text("canonical_reading"),
    status: text("status").default("active").notNull(),
    sourceEntryId: text("source_entry_id"),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    index("entries_language_idx").on(table.languageId),
    index("entries_canonical_form_idx").on(table.canonicalForm),
    foreignKey({
      columns: [table.languageId],
      foreignColumns: [languages.id],
    }),
    foreignKey({
      columns: [table.dictionaryId],
      foreignColumns: [dictionaries.id],
    }).onDelete("set null"),
  ],
);

export const entryForms = sqliteTable(
  "entry_forms",
  {
    id: text("id").primaryKey().notNull(),
    entryId: text("entry_id").notNull(),
    text: text("text").notNull(),
    script: text("script"),
    formType: text("form_type").default("headword").notNull(),
    isPrimary: integer("is_primary", { mode: "boolean" }).default(false),
    isCommon: integer("is_common", { mode: "boolean" }).default(false),
    appliesToReading: text("applies_to_reading"),
    rawRank: integer("raw_rank"),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    index("entry_forms_entry_idx").on(table.entryId),
    index("entry_forms_text_idx").on(table.text),
    foreignKey({
      columns: [table.entryId],
      foreignColumns: [entries.id],
    }).onDelete("cascade"),
  ],
);

export const entryReadings = sqliteTable(
  "entry_readings",
  {
    id: text("id").primaryKey().notNull(),
    entryId: text("entry_id").notNull(),
    text: text("text").notNull(),
    system: text("system"),
    script: text("script"),
    isPrimary: integer("is_primary", { mode: "boolean" }).default(false),
    isCommon: integer("is_common", { mode: "boolean" }).default(false),
    rawRank: integer("raw_rank"),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    index("entry_readings_entry_idx").on(table.entryId),
    index("entry_readings_text_idx").on(table.text),
    foreignKey({
      columns: [table.entryId],
      foreignColumns: [entries.id],
    }).onDelete("cascade"),
  ],
);

export const entrySenses = sqliteTable(
  "entry_senses",
  {
    id: text("id").primaryKey().notNull(),
    entryId: text("entry_id").notNull(),
    senseOrder: integer("sense_order").notNull(),
    partOfSpeech: text("part_of_speech"),
    register: text("register"),
    domain: text("domain"),
    dialect: text("dialect"),
    info: text("info"),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    index("entry_senses_entry_idx").on(table.entryId),
    foreignKey({
      columns: [table.entryId],
      foreignColumns: [entries.id],
    }).onDelete("cascade"),
  ],
);

export const senseGlosses = sqliteTable(
  "sense_glosses",
  {
    id: text("id").primaryKey().notNull(),
    senseId: text("sense_id").notNull(),
    glossLanguage: text("gloss_language").notNull(),
    glossOrder: integer("gloss_order").notNull(),
    text: text("text").notNull(),
    gender: text("gender"),
    glossType: text("gloss_type"),
  },
  (table) => [
    index("sense_glosses_sense_idx").on(table.senseId),
    index("sense_glosses_text_idx").on(table.text),
    foreignKey({
      columns: [table.senseId],
      foreignColumns: [entrySenses.id],
    }).onDelete("cascade"),
  ],
);

export const entryRelations = sqliteTable(
  "entry_relations",
  {
    id: text("id").primaryKey().notNull(),
    entryId: text("entry_id").notNull(),
    relatedEntryId: text("related_entry_id").notNull(),
    relationType: text("relation_type").notNull(),
    relationOrder: integer("relation_order"),
  },
  (table) => [
    index("entry_relations_entry_idx").on(table.entryId),
    foreignKey({
      columns: [table.entryId],
      foreignColumns: [entries.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.relatedEntryId],
      foreignColumns: [entries.id],
    }).onDelete("cascade"),
  ],
);

export const examples = sqliteTable(
  "examples",
  {
    id: text("id").primaryKey().notNull(),
    languageId: text("language_id").notNull(),
    text: text("text").notNull(),
    textNormalized: text("text_normalized"),
    translationGroupId: text("translation_group_id"),
    sourceType: text("source_type"),
    sourceRef: text("source_ref"),
    difficultyBand: text("difficulty_band"),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
    updatedAt: text("updated_at").$onUpdate(
      () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    index("examples_language_idx").on(table.languageId),
    index("examples_text_idx").on(table.text),
    foreignKey({
      columns: [table.languageId],
      foreignColumns: [languages.id],
    }),
  ],
);

export const exampleTranslations = sqliteTable(
  "example_translations",
  {
    id: text("id").primaryKey().notNull(),
    exampleId: text("example_id").notNull(),
    languageCode: text("language_code").notNull(),
    text: text("text").notNull(),
    translationOrder: integer("translation_order").default(1).notNull(),
  },
  (table) => [
    index("example_translations_example_idx").on(table.exampleId),
    foreignKey({
      columns: [table.exampleId],
      foreignColumns: [examples.id],
    }).onDelete("cascade"),
  ],
);

export const entryExamples = sqliteTable(
  "entry_examples",
  {
    id: text("id").primaryKey().notNull(),
    entryId: text("entry_id").notNull(),
    senseId: text("sense_id"),
    exampleId: text("example_id").notNull(),
    relationType: text("relation_type").default("example").notNull(),
  },
  (table) => [
    index("entry_examples_entry_idx").on(table.entryId),
    foreignKey({
      columns: [table.entryId],
      foreignColumns: [entries.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.senseId],
      foreignColumns: [entrySenses.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.exampleId],
      foreignColumns: [examples.id],
    }).onDelete("cascade"),
  ],
);

export const zhEntryData = sqliteTable(
  "zh_entry_data",
  {
    entryId: text("entry_id").primaryKey().notNull(),
    hsk: text("hsk"),
    frequencyRank: integer("frequency_rank"),
    variantRank: integer("variant_rank"),
    decompositionData: text("decomposition_data"),
    classifierInfo: text("classifier_info"),
    strokeAssetId: text("stroke_asset_id"),
  },
  (table) => [
    foreignKey({
      columns: [table.entryId],
      foreignColumns: [entries.id],
    }).onDelete("cascade"),
  ],
);

export const zhCharacterData = sqliteTable("zh_character_data", {
  character: text("character").primaryKey().notNull(),
  decompositionData: text("decomposition_data"),
  frequencyRank: integer("frequency_rank"),
  hsk: text("hsk"),
  svgSimplified: text("svg_simplified"),
  svgTraditional: text("svg_traditional"),
  svgSpecial: text("svg_special"),
});

export const jaEntryData = sqliteTable(
  "ja_entry_data",
  {
    entryId: text("entry_id").primaryKey().notNull(),
    jlpt: text("jlpt"),
    isCommon: integer("is_common", { mode: "boolean" }).default(false),
    frequencyRank: integer("frequency_rank"),
    priorityTags: text("priority_tags"),
    nameType: text("name_type"),
    kanjidicCharacterRefs: text("kanjidic_character_refs"),
  },
  (table) => [
    foreignKey({
      columns: [table.entryId],
      foreignColumns: [entries.id],
    }).onDelete("cascade"),
  ],
);

export const jaPitchAccents = sqliteTable(
  "ja_pitch_accents",
  {
    id: text("id").primaryKey().notNull(),
    entryId: text("entry_id").notNull(),
    dictionaryId: text("dictionary_id"),
    surfaceForm: text("surface_form").notNull(),
    reading: text("reading").notNull(),
    pronunciation: text("pronunciation"),
    accentNumber: integer("accent_number").notNull(),
    accentOrder: integer("accent_order").default(1).notNull(),
    accentPattern: text("accent_pattern"),
    rawAccentType: text("raw_accent_type").notNull(),
    rawAccentConType: text("raw_accent_con_type"),
    rawAccentModType: text("raw_accent_mod_type"),
    moraCount: integer("mora_count"),
    sourcePosClass: text("source_pos_class"),
    sourceLexemeId: text("source_lexeme_id"),
    sourceLemmaId: text("source_lemma_id"),
    sourceLine: integer("source_line"),
    matchType: text("match_type").notNull(),
    createdAt: text("created_at").default(
      sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
    ),
  },
  (table) => [
    index("ja_pitch_accents_entry_idx").on(table.entryId),
    index("ja_pitch_accents_surface_idx").on(table.surfaceForm),
    index("ja_pitch_accents_reading_idx").on(table.reading),
    foreignKey({
      columns: [table.entryId],
      foreignColumns: [entries.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.dictionaryId],
      foreignColumns: [dictionaries.id],
    }).onDelete("set null"),
  ],
);

export const jaCharacterData = sqliteTable("ja_character_data", {
  character: text("character").primaryKey().notNull(),
  grade: integer("grade"),
  strokeCounts: text("stroke_counts"),
  frequency: integer("frequency"),
  jlpt: text("jlpt"),
  radicalClassical: integer("radical_classical"),
  radicalNelson: integer("radical_nelson"),
  readingsJson: text("readings_json"),
  meaningsJson: text("meanings_json"),
  svg: text("svg"),
});

export const jaCharacterComponents = sqliteTable(
  "ja_character_components",
  {
    id: text("id").primaryKey().notNull(),
    character: text("character").notNull(),
    component: text("component").notNull(),
    componentOrder: integer("component_order"),
  },
  (table) => [index("ja_character_components_character_idx").on(table.character)],
);

export const jaRadicals = sqliteTable("ja_radicals", {
  radical: text("radical").primaryKey().notNull(),
  strokeCount: integer("stroke_count"),
  code: text("code"),
});

export const jaRadicalCharacters = sqliteTable(
  "ja_radical_characters",
  {
    id: text("id").primaryKey().notNull(),
    radical: text("radical").notNull(),
    character: text("character").notNull(),
  },
  (table) => [
    index("ja_radical_characters_radical_idx").on(table.radical),
    foreignKey({
      columns: [table.radical],
      foreignColumns: [jaRadicals.radical],
    }).onDelete("cascade"),
  ],
);

export const entriesRelations = relations(entries, ({ many, one }) => ({
  language: one(languages, {
    fields: [entries.languageId],
    references: [languages.id],
  }),
  dictionary: one(dictionaries, {
    fields: [entries.dictionaryId],
    references: [dictionaries.id],
  }),
  forms: many(entryForms),
  readings: many(entryReadings),
  senses: many(entrySenses),
  outgoingRelations: many(entryRelations, { relationName: "entry_outgoing" }),
  incomingRelations: many(entryRelations, { relationName: "entry_incoming" }),
  examples: many(entryExamples),
  zhData: many(zhEntryData),
  jaData: many(jaEntryData),
  pitchAccents: many(jaPitchAccents),
  knowledge: many(knowledge),
}));

export const entryFormsRelations = relations(entryForms, ({ one }) => ({
  entry: one(entries, {
    fields: [entryForms.entryId],
    references: [entries.id],
  }),
}));

export const entryReadingsRelations = relations(entryReadings, ({ one }) => ({
  entry: one(entries, {
    fields: [entryReadings.entryId],
    references: [entries.id],
  }),
}));

export const entrySensesRelations = relations(entrySenses, ({ many, one }) => ({
  entry: one(entries, {
    fields: [entrySenses.entryId],
    references: [entries.id],
  }),
  glosses: many(senseGlosses),
  examples: many(entryExamples),
}));

export const senseGlossesRelations = relations(senseGlosses, ({ one }) => ({
  sense: one(entrySenses, {
    fields: [senseGlosses.senseId],
    references: [entrySenses.id],
  }),
}));

export const entryRelationsRelations = relations(entryRelations, ({ one }) => ({
  entry: one(entries, {
    fields: [entryRelations.entryId],
    references: [entries.id],
    relationName: "entry_outgoing",
  }),
  relatedEntry: one(entries, {
    fields: [entryRelations.relatedEntryId],
    references: [entries.id],
    relationName: "entry_incoming",
  }),
}));

export const examplesRelations = relations(examples, ({ many, one }) => ({
  language: one(languages, {
    fields: [examples.languageId],
    references: [languages.id],
  }),
  translations: many(exampleTranslations),
  entryLinks: many(entryExamples),
}));

export const exampleTranslationsRelations = relations(
  exampleTranslations,
  ({ one }) => ({
    example: one(examples, {
      fields: [exampleTranslations.exampleId],
      references: [examples.id],
    }),
  }),
);

export const entryExamplesRelations = relations(entryExamples, ({ one }) => ({
  entry: one(entries, {
    fields: [entryExamples.entryId],
    references: [entries.id],
  }),
  sense: one(entrySenses, {
    fields: [entryExamples.senseId],
    references: [entrySenses.id],
  }),
  example: one(examples, {
    fields: [entryExamples.exampleId],
    references: [examples.id],
  }),
}));

export const zhEntryDataRelations = relations(zhEntryData, ({ one }) => ({
  entry: one(entries, {
    fields: [zhEntryData.entryId],
    references: [entries.id],
  }),
}));

export const jaEntryDataRelations = relations(jaEntryData, ({ one }) => ({
  entry: one(entries, {
    fields: [jaEntryData.entryId],
    references: [entries.id],
  }),
}));

export const jaPitchAccentsRelations = relations(jaPitchAccents, ({ one }) => ({
  entry: one(entries, {
    fields: [jaPitchAccents.entryId],
    references: [entries.id],
  }),
  dictionary: one(dictionaries, {
    fields: [jaPitchAccents.dictionaryId],
    references: [dictionaries.id],
  }),
}));

export const premadeDecks = sqliteTable(
  "premade_decks",
  {
    id: text("id").primaryKey().notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    book: text("book").notNull(),
    lesson: integer("lesson").notNull(),
    languageId: text("language_id").notNull(),
    source: text("source").notNull(),
    isPublished: integer("is_published", { mode: "boolean" }).default(false).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("premade_decks_slug_idx").on(table.slug),
    index("premade_decks_language_idx").on(table.languageId),
  ],
);

export const premadeItems = sqliteTable(
  "premade_items",
  {
    id: text("id").primaryKey().notNull(),
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
    dictionarySenseIds: text("dictionary_sense_ids").notNull(),
    usesAllSenses: integer("uses_all_senses", { mode: "boolean" }).default(false).notNull(),
    matchStatus: text("match_status"),
    matchMethod: text("match_method"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.premadeDeckId],
      foreignColumns: [premadeDecks.id],
    }).onDelete("cascade"),
    index("premade_items_deck_sort_idx").on(table.premadeDeckId, table.sortOrder),
    index("premade_items_entry_idx").on(table.dictionaryEntryId),
  ],
);

export const premadeDecksRelations = relations(premadeDecks, ({ many }) => ({
  items: many(premadeItems),
}));

export const premadeItemsRelations = relations(premadeItems, ({ one }) => ({
  deck: one(premadeDecks, {
    fields: [premadeItems.premadeDeckId],
    references: [premadeDecks.id],
  }),
}));

export const premadeSyncState = sqliteTable("premade_sync_state", {
  id: text("id").primaryKey().notNull(),
  lastPulledAt: text("last_pulled_at"),
  lastCursor: text("last_cursor"),
  lastSuccessfulSyncAt: text("last_successful_sync_at"),
  lastError: text("last_error"),
});

export const permanentDeleteEntityTypes = [
  "deckFolder",
  "deck",
  "deckLink",
  "card",
  "knowledge",
  "knowledgeLink",
  "cardLink",
] as const;
export type PermanentDeleteEntityType =
  (typeof permanentDeleteEntityTypes)[number];

export const permanentDeletes = sqliteTable(
  "permanent_deletes",
  {
    id: text("id").primaryKey().notNull(),
    entityType: text("entity_type", {
      enum: permanentDeleteEntityTypes,
    }).notNull(),
    entityId: text("entity_id").notNull(),
    deletedAt: text("deleted_at").notNull(),
  },
  (table) => [
    index("permanent_deletes_entity_idx").on(table.entityType, table.entityId),
    index("permanent_deletes_deleted_at_idx").on(table.deletedAt),
  ],
);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey().notNull(),
  value: text("value"),
  updatedAt: text("updated_at").$onUpdate(
    () => sql`(strftime('%Y-%m-%d %H:%M:%f', 'now'))`,
  ),
});

// --- FSRS Parameters ---
export const fsrsParams = sqliteTable("params", {
  id: text("id").primaryKey().notNull(),
  weights: text("weights").default(jsonDefaultWeights).notNull(),
  requestRetention: real("request_retention")
    .default(default_request_retention)
    .notNull(),
  maximumInterval: integer("maximum_interval")
    .default(default_maximum_interval)
    .notNull(),
  enableFuzz: integer("enable_fuzz", { mode: "boolean" })
    .default(default_enable_fuzz)
    .notNull(),
  enableShortTerm: integer("enable_short_term", { mode: "boolean" })
    .default(default_enable_short_term === 1 ? true : false)
    .notNull(),
  cardLimit: integer("card_limit").default(50).notNull(),
  lapses: integer("lapses").default(8).notNull(),
  // userId removed
});

// No relations needed for fsrsParams if it's a single global setting without users

// You might want to add relations back if you plan multiple parameter sets,
// but for a simple local app, a single row identified by a known ID might suffice.
// export const fsrsParamsRelations = relations(fsrsParams, ({ one }) => ({
//   // user: one(users, { ... }), // Removed
// }));
//

export const exampleDecks = sqliteTable("example_decks", {
  id: text("id").primaryKey().notNull(),
  // test: text("new").unique
});
