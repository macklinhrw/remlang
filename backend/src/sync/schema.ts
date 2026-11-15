import { z } from "zod";

const timestampSchema = z.string().datetime({ offset: true });
const nullableTimestampSchema = timestampSchema.nullable().optional();
const nullableStringSchema = z.string().nullable().optional();

export const syncModeSchema = z.enum(["manual", "automatic"]);
export const syncConflictStrategySchema = z.enum(["remote", "local"]);

export const registerDeviceSchema = z.object({
  deviceId: z.string().min(1),
  platform: z.string().min(1).optional(),
  appVersion: z.string().min(1).optional(),
  syncMode: syncModeSchema.default("manual"),
  conflictStrategy: syncConflictStrategySchema.default("remote"),
});

export const syncDeckFolderSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  languageId: nullableStringSchema,
  parentId: nullableStringSchema,
  newCardsPaused: z.boolean().default(false),
  createdAt: nullableTimestampSchema,
  updatedAt: nullableTimestampSchema,
  deletedAt: nullableTimestampSchema,
});

export const syncDeckSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  visibility: z.string().default("Private"),
  isStarred: z.boolean().default(false),
  folderId: nullableStringSchema,
  languageId: nullableStringSchema,
  sourceReviewType: nullableStringSchema,
  primaryDeckId: nullableStringSchema,
  newCardsPaused: z.boolean().default(false),
  createdAt: nullableTimestampSchema,
  updatedAt: nullableTimestampSchema,
  deletedAt: nullableTimestampSchema,
});

export const syncDeckLinkSchema = z.object({
  id: z.string().min(1),
  primaryDeckId: z.string().min(1),
  linkedDeckId: z.string().min(1),
  targetReviewType: z.string().min(1),
  createdAt: nullableTimestampSchema,
  updatedAt: nullableTimestampSchema,
});

export const syncAppSettingSchema = z.object({
  key: z.string().min(1),
  value: nullableStringSchema,
  updatedAt: nullableTimestampSchema,
});

export const syncPermanentDeleteEntityTypeSchema = z.enum([
  "deckFolder",
  "deck",
  "deckLink",
  "card",
  "knowledge",
  "knowledgeLink",
  "cardLink",
]);

export const syncPermanentDeleteSchema = z.object({
  id: z.string().min(1),
  entityType: syncPermanentDeleteEntityTypeSchema,
  entityId: z.string().min(1),
  deletedAt: timestampSchema,
});

export const syncKnowledgeSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  definitions: z.string().min(1),
  sourceDefinitions: nullableStringSchema,
  pronunciation: nullableStringSchema,
  wordId: nullableStringSchema,
  entryId: nullableStringSchema,
  focus: nullableStringSchema,
  showFocus: z.boolean().default(false),
  focusAllowsDuplicates: z.boolean().default(true),
  note: nullableStringSchema,
  tags: nullableStringSchema,
  primaryPitchAccentDictionaryId: nullableStringSchema,
  primaryPitchAccentReading: nullableStringSchema,
  primaryPitchAccentAccentNumber: z.number().int().nullable().optional(),
  primaryPitchAccentIsCustom: z.boolean().nullable().optional(),
  configSignature: z.string().default("__all__"),
  definitionConfig: z.record(z.string(), z.any()).nullable().optional(),
  configLabel: nullableStringSchema,
  due: timestampSchema,
  stability: z.number().default(0),
  difficulty: z.number().default(0),
  elapsedDays: z.number().default(0),
  scheduledDays: z.number().default(0),
  learningSteps: z.number().int().default(0),
  reps: z.number().int().default(0),
  lapses: z.number().int().default(0),
  state: z.string().default("New"),
  lastReview: timestampSchema,
  reviewType: z.string().default("Front-Back"),
  deleted: z.boolean().default(false),
  suspended: z.boolean().default(false),
  createdAt: nullableTimestampSchema,
  updatedAt: nullableTimestampSchema,
  deletedAt: nullableTimestampSchema,
});

export const syncCardSchema = z.object({
  id: z.string().min(1),
  deckId: z.string().min(1),
  knowledgeId: z.string().min(1),
  note: nullableStringSchema,
  tags: nullableStringSchema,
  createdAt: nullableTimestampSchema,
  updatedAt: nullableTimestampSchema,
  deletedAt: nullableTimestampSchema,
});

export const syncKnowledgeLinkSchema = z.object({
  id: z.string().min(1),
  deckLinkId: z.string().min(1),
  sourceKnowledgeId: z.string().min(1),
  mirroredKnowledgeId: z.string().min(1),
  createdAt: nullableTimestampSchema,
  updatedAt: nullableTimestampSchema,
});

export const syncCardLinkSchema = z.object({
  id: z.string().min(1),
  deckLinkId: z.string().min(1),
  sourceCardId: z.string().min(1),
  mirroredCardId: z.string().min(1),
  createdAt: nullableTimestampSchema,
  updatedAt: nullableTimestampSchema,
});

export const syncReviewLogSchema = z.object({
  id: z.string().min(1),
  knowledgeId: z.string().min(1),
  rating: nullableStringSchema,
  review: timestampSchema,
  due: timestampSchema,
  stability: z.number().default(0),
  difficulty: z.number().default(0),
  elapsedDays: z.number().default(0),
  scheduledDays: z.number().default(0),
  learningSteps: z.number().int().default(0),
  state: z.string().default("New"),
  lastElapsedDays: z.number().default(0),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  deleted: z.boolean().default(false),
  createdAt: nullableTimestampSchema,
  updatedAt: nullableTimestampSchema,
});

export const syncReviewUndoSchema = z.object({
  id: z.string().min(1),
  knowledgeId: z.string().min(1),
  reviewLogId: z.string().min(1),
  due: timestampSchema,
  stability: z.number().default(0),
  difficulty: z.number().default(0),
  elapsedDays: z.number().default(0),
  scheduledDays: z.number().default(0),
  learningSteps: z.number().int().default(0),
  reps: z.number().int().default(0),
  lapses: z.number().int().default(0),
  state: z.string().default("New"),
  lastReview: timestampSchema,
  undone: z.boolean().default(false),
  invalidated: z.boolean().default(false),
  createdAt: nullableTimestampSchema,
  updatedAt: nullableTimestampSchema,
});

export const syncPushSchema = z.object({
  deviceId: z.string().min(1),
  syncMode: syncModeSchema.default("manual"),
  conflictStrategy: syncConflictStrategySchema.default("remote"),
  exportedAt: timestampSchema,
  deckFolders: z.array(syncDeckFolderSchema).default([]),
  decks: z.array(syncDeckSchema).default([]),
  deckLinks: z.array(syncDeckLinkSchema).default([]),
  appSettings: z.array(syncAppSettingSchema).default([]),
  permanentDeletes: z.array(syncPermanentDeleteSchema).default([]),
  knowledge: z.array(syncKnowledgeSchema).default([]),
  cards: z.array(syncCardSchema).default([]),
  knowledgeLinks: z.array(syncKnowledgeLinkSchema).default([]),
  cardLinks: z.array(syncCardLinkSchema).default([]),
  reviewLogs: z.array(syncReviewLogSchema).default([]),
  reviewUndos: z.array(syncReviewUndoSchema).default([]),
});

export const syncPullSchema = z.object({
  deviceId: z.string().min(1),
  since: nullableTimestampSchema,
  until: nullableTimestampSchema,
  offsets: z
    .object({
      deckFolders: z.number().int().min(0).default(0),
      decks: z.number().int().min(0).default(0),
      deckLinks: z.number().int().min(0).default(0),
      appSettings: z.number().int().min(0).default(0),
      permanentDeletes: z.number().int().min(0).default(0),
      knowledge: z.number().int().min(0).default(0),
      cards: z.number().int().min(0).default(0),
      knowledgeLinks: z.number().int().min(0).default(0),
      cardLinks: z.number().int().min(0).default(0),
      reviewLogs: z.number().int().min(0).default(0),
      reviewUndos: z.number().int().min(0).default(0),
    })
    .partial()
    .optional(),
  limitPerTable: z.number().int().min(1).max(5000).default(2000),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type SyncPushInput = z.infer<typeof syncPushSchema>;
export type SyncPullInput = z.infer<typeof syncPullSchema>;
