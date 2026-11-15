import { eq, inArray, sql } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import {
  appSettings,
  cardLinks,
  cards,
  decks,
  decksFolders,
  knowledge,
  knowledgeLinks,
  permanentDeletes,
  type PermanentDeleteEntityType,
  reviewLog,
  reviewUndo,
} from "@/lib/database/schema";
import { parseStoredDateTime } from "@/lib/review/fsrs";
import { isGlobalReviewLimitSettingKey } from "@/lib/review/reviewLimits";
import { isStrokeAnimationSpeedSettingKey } from "@/lib/store/strokeAnimationSpeedStore";
import { getSyncSettingsSnapshot, type SyncMode } from "@/lib/sync/settings";

const EXPORT_MAP_CHUNK_SIZE = 250;

const yieldToUi = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const mapInChunks = async <T, U>(
  items: T[],
  mapper: (item: T) => U,
): Promise<U[]> => {
  const results: U[] = [];

  for (let index = 0; index < items.length; index += EXPORT_MAP_CHUNK_SIZE) {
    const chunk = items.slice(index, index + EXPORT_MAP_CHUNK_SIZE);
    results.push(...chunk.map(mapper));
    await yieldToUi();
  }

  return results;
};

const toIsoString = (value: string | null | undefined) =>
  parseStoredDateTime(value)?.toISOString() ?? null;

const parseDefinitionConfig = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

export interface UserSyncSnapshot {
  schemaVersion: 2;
  exportedAt: string;
  deviceId: string;
  syncMode: SyncMode;
  languageId: string | null;
  deckFolders: {
    id: string;
    name: string;
    languageId: string | null;
    parentId: string | null;
    newCardsPaused: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    deletedAt: string | null;
  }[];
  decks: {
    id: string;
    name: string;
    visibility: string;
    isStarred: boolean;
    folderId: string | null;
    languageId: string | null;
    sourceReviewType: string | null;
    primaryDeckId: string | null;
    newCardsPaused: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    deletedAt: string | null;
  }[];
  deckLinks: {
    id: string;
    primaryDeckId: string;
    linkedDeckId: string;
    targetReviewType: string;
    createdAt: string | null;
    updatedAt: string | null;
  }[];
  appSettings: {
    key: string;
    value: string | null;
    updatedAt: string | null;
  }[];
  permanentDeletes: {
    id: string;
    entityType: PermanentDeleteEntityType;
    entityId: string;
    deletedAt: string;
  }[];
  knowledge: {
    id: string;
    front: string;
    definitions: string;
    sourceDefinitions: string | null;
    pronunciation: string | null;
    wordId: string | null;
    entryId: string | null;
    focus: string | null;
    showFocus: boolean;
    focusAllowsDuplicates: boolean;
    note: string | null;
    tags: string | null;
    primaryPitchAccentDictionaryId: string | null;
    primaryPitchAccentReading: string | null;
    primaryPitchAccentAccentNumber: number | null;
    primaryPitchAccentIsCustom: boolean | null;
    configSignature: string;
    definitionConfig: Record<string, unknown> | null;
    configLabel: string | null;
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    reps: number;
    lapses: number;
    state: string;
    lastReview: string;
    reviewType: string;
    deleted: boolean;
    suspended: boolean;
    createdAt: string | null;
    updatedAt: string | null;
    deletedAt: string | null;
  }[];
  cards: {
    id: string;
    deckId: string;
    knowledgeId: string;
    note: string | null;
    tags: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    deletedAt: string | null;
  }[];
  knowledgeLinks: {
    id: string;
    deckLinkId: string;
    sourceKnowledgeId: string;
    mirroredKnowledgeId: string;
    createdAt: string | null;
    updatedAt: string | null;
  }[];
  cardLinks: {
    id: string;
    deckLinkId: string;
    sourceCardId: string;
    mirroredCardId: string;
    createdAt: string | null;
    updatedAt: string | null;
  }[];
  reviewLogs: {
    id: string;
    knowledgeId: string;
    rating: string | null;
    review: string;
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    state: string;
    lastElapsedDays: number;
    durationMs?: number | null;
    deleted: boolean;
    createdAt: string | null;
    updatedAt: string | null;
  }[];
  reviewUndos: {
    id: string;
    knowledgeId: string;
    reviewLogId: string;
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    reps: number;
    lapses: number;
    state: string;
    lastReview: string;
    undone: boolean;
    invalidated: boolean;
    createdAt: string | null;
    updatedAt: string | null;
  }[];
}

export const exportUserSyncSnapshot = async (
  db: DrizzleInstance,
  input?: {
    languageId?: string | null;
  },
  options?: {
    onProgress?: (progress: { label: string; completed: number; total: number }) => void;
  },
): Promise<UserSyncSnapshot> => {
  const reportProgress = (completed: number, total: number) => {
    options?.onProgress?.({
      label: "Prepare",
      completed,
      total,
    });
  };

  const totalSteps = 7;
  let completedSteps = 0;
  reportProgress(completedSteps, totalSteps);

  const syncSettings = await getSyncSettingsSnapshot(db);
  completedSteps += 1;
  reportProgress(completedSteps, totalSteps);
  const deckRows = await db.query.decks.findMany({
    where: input?.languageId ? eq(decks.languageId, input.languageId) : undefined,
  });
  completedSteps += 1;
  reportProgress(completedSteps, totalSteps);
  const deckIds = deckRows.map((deck) => deck.id);
  const folderIds = [...new Set(deckRows.map((deck) => deck.folderId).filter(Boolean))];
  const allFolderRows = await db.query.decksFolders.findMany();
  const folderRows = input?.languageId
    ? allFolderRows.filter(
        (row) =>
          row.languageId === input.languageId ||
          (row.languageId === null && folderIds.includes(row.id)),
      )
    : allFolderRows;
  completedSteps += 1;
  reportProgress(completedSteps, totalSteps);
  const cardRows =
    deckIds.length > 0
      ? await db.query.cards.findMany({
          where: inArray(cards.deckId, deckIds),
        })
      : [];
  completedSteps += 1;
  reportProgress(completedSteps, totalSteps);
  const deckLinkRows =
    deckIds.length > 0
      ? await db.query.deckLinks.findMany()
      : [];
  const syncedAppSettingRows = await db.query.appSettings.findMany({
    where: sql`${appSettings.key} like 'review_limits:%:global:%' or ${appSettings.key} = 'stroke_animation_speed'`,
  });
  const permanentDeleteRows = await db.query.permanentDeletes.findMany();
  const relevantDeckLinkRows = deckLinkRows.filter(
    (row) => deckIds.includes(row.primaryDeckId) || deckIds.includes(row.linkedDeckId),
  );
  const deckLinkIds = relevantDeckLinkRows.map((row) => row.id);
  const knowledgeIds = [...new Set(cardRows.map((card) => card.knowledgeId))];
  const knowledgeRows =
    knowledgeIds.length > 0
      ? await db.query.knowledge.findMany({
          where: inArray(knowledge.id, knowledgeIds),
        })
      : [];
  completedSteps += 1;
  reportProgress(completedSteps, totalSteps);
  const knowledgeLinkRows =
    deckLinkIds.length > 0
      ? await db.query.knowledgeLinks.findMany({
          where: inArray(knowledgeLinks.deckLinkId, deckLinkIds),
        })
      : [];
  const cardLinkRows =
    deckLinkIds.length > 0
      ? await db.query.cardLinks.findMany({
          where: inArray(cardLinks.deckLinkId, deckLinkIds),
        })
      : [];
  const reviewRows =
    knowledgeIds.length > 0
      ? await db.query.reviewLog.findMany({
          where: inArray(reviewLog.knowledgeId, knowledgeIds),
        })
      : [];
  const reviewUndoRows =
    knowledgeIds.length > 0
      ? await db.query.reviewUndo.findMany({
          where: inArray(reviewUndo.knowledgeId, knowledgeIds),
        })
      : [];
  completedSteps += 1;
  reportProgress(completedSteps, totalSteps);

  const exportedDeckFolders = await mapInChunks(folderRows, (row) => ({
    id: row.id,
    name: row.name,
    languageId: row.languageId ?? null,
    parentId: row.parentId ?? null,
    newCardsPaused: row.newCardsPaused ?? false,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    deletedAt: row.deleted ? toIsoString(row.deletedAt ?? row.updatedAt) : null,
  }));
  const exportedDecks = await mapInChunks(deckRows, (row) => ({
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    isStarred: row.isStarred ?? false,
    folderId: row.folderId ?? null,
    languageId: row.languageId ?? null,
    sourceReviewType: row.sourceReviewType ?? null,
    primaryDeckId: row.primaryDeckId ?? null,
    newCardsPaused: row.newCardsPaused ?? false,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    deletedAt: row.deleted ? toIsoString(row.deletedAt ?? row.updatedAt) : null,
  }));
  const exportedDeckLinks = await mapInChunks(relevantDeckLinkRows, (row) => ({
    id: row.id,
    primaryDeckId: row.primaryDeckId,
    linkedDeckId: row.linkedDeckId,
    targetReviewType: row.targetReviewType,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  }));
  const exportedAppSettings = await mapInChunks(syncedAppSettingRows, (row) => ({
    key: row.key,
    value: row.value ?? null,
    updatedAt: toIsoString(row.updatedAt),
  })).then((rows) =>
    rows.filter(
      (row) =>
        isGlobalReviewLimitSettingKey(row.key) ||
        isStrokeAnimationSpeedSettingKey(row.key),
    ),
  );
  const exportedPermanentDeletes = await mapInChunks(permanentDeleteRows, (row) => ({
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    deletedAt: toIsoString(row.deletedAt) ?? new Date().toISOString(),
  }));
  const exportedKnowledge = await mapInChunks(knowledgeRows, (row) => ({
    id: row.id,
    front: row.front,
    definitions: row.definitions,
    sourceDefinitions: row.sourceDefinitions ?? null,
    pronunciation: row.pronunciation ?? null,
    wordId: row.wordId ?? null,
    entryId: row.entryId ?? null,
    focus: row.focus ?? null,
    showFocus: row.showFocus ?? false,
    focusAllowsDuplicates: row.focusAllowsDuplicates ?? true,
    note: row.note ?? null,
    tags: row.tags ?? null,
    primaryPitchAccentDictionaryId: row.primaryPitchAccentDictionaryId ?? null,
    primaryPitchAccentReading: row.primaryPitchAccentReading ?? null,
    primaryPitchAccentAccentNumber: row.primaryPitchAccentAccentNumber ?? null,
    primaryPitchAccentIsCustom:
      typeof row.primaryPitchAccentIsCustom === "boolean"
        ? row.primaryPitchAccentIsCustom
        : null,
    configSignature: row.configSignature ?? "__all__",
    definitionConfig: parseDefinitionConfig(row.definitionConfig),
    configLabel: row.configLabel ?? null,
    due: toIsoString(row.due) ?? new Date().toISOString(),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastReview: toIsoString(row.lastReview) ?? new Date().toISOString(),
    reviewType: row.reviewType,
    deleted: row.deleted ?? false,
    suspended: row.suspended ?? false,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    deletedAt: row.deleted ? toIsoString(row.updatedAt) : null,
  }));
  const exportedCards = await mapInChunks(cardRows, (row) => ({
    id: row.id,
    deckId: row.deckId,
    knowledgeId: row.knowledgeId,
    note: row.note ?? null,
    tags: row.tags ?? null,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
    deletedAt: row.deleted ? toIsoString(row.deletedAt ?? row.updatedAt) : null,
  }));
  const exportedKnowledgeLinks = await mapInChunks(knowledgeLinkRows, (row) => ({
    id: row.id,
    deckLinkId: row.deckLinkId,
    sourceKnowledgeId: row.sourceKnowledgeId,
    mirroredKnowledgeId: row.mirroredKnowledgeId,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  }));
  const exportedCardLinks = await mapInChunks(cardLinkRows, (row) => ({
    id: row.id,
    deckLinkId: row.deckLinkId,
    sourceCardId: row.sourceCardId,
    mirroredCardId: row.mirroredCardId,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  }));
  const exportedReviewLogs = await mapInChunks(reviewRows, (row) => ({
    id: row.id,
    knowledgeId: row.knowledgeId ?? "",
    rating: row.rating ?? null,
    review: toIsoString(row.review) ?? new Date().toISOString(),
    due: toIsoString(row.due) ?? new Date().toISOString(),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    state: row.state,
    lastElapsedDays: row.lastElapsedDays,
    durationMs: row.durationMs,
    deleted: row.deleted ?? false,
    createdAt: toIsoString(row.createdAt ?? row.review),
    updatedAt: toIsoString(row.updatedAt ?? row.createdAt ?? row.review),
  }));
  const exportedReviewUndos = await mapInChunks(reviewUndoRows, (row) => ({
    id: row.id,
    knowledgeId: row.knowledgeId,
    reviewLogId: row.reviewLogId,
    due: toIsoString(row.due) ?? new Date().toISOString(),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastReview: toIsoString(row.lastReview) ?? new Date().toISOString(),
    undone: row.undone ?? false,
    invalidated: row.invalidated ?? false,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt ?? row.createdAt),
  }));
  completedSteps += 1;
  reportProgress(completedSteps, totalSteps);

  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    deviceId: syncSettings.deviceId,
    syncMode: syncSettings.mode,
    languageId: input?.languageId ?? null,
    deckFolders: exportedDeckFolders,
    decks: exportedDecks,
    deckLinks: exportedDeckLinks,
    appSettings: exportedAppSettings,
    permanentDeletes: exportedPermanentDeletes,
    knowledge: exportedKnowledge,
    cards: exportedCards,
    knowledgeLinks: exportedKnowledgeLinks,
    cardLinks: exportedCardLinks,
    reviewLogs: exportedReviewLogs,
    reviewUndos: exportedReviewUndos,
  };
};
