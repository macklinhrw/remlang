import { and, asc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  syncAppSettings,
  syncCardLinks,
  syncCards,
  syncDeckLinks,
  syncDeckFolders,
  syncDecks,
  syncDevices,
  syncKnowledge,
  syncKnowledgeLinks,
  syncPermanentDeletes,
  syncReviewLogs,
  syncReviewUndos,
  syncUsers,
} from "../db/schema";
import type {
  RegisterDeviceInput,
  SyncPullInput,
  SyncPushInput,
} from "./schema";

type SyncTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const toDate = (value: string | null | undefined) =>
  value ? new Date(value) : null;

const newerEntityWhere = (
  tableName: string,
  options?: { hasCreatedAt?: boolean },
) => {
  const hasCreatedAt = options?.hasCreatedAt ?? true;

  return hasCreatedAt
    ? sql.raw(`
  coalesce(excluded.updated_at, excluded.created_at, '-infinity'::timestamptz) >
  coalesce(${tableName}.updated_at, ${tableName}.created_at, '-infinity'::timestamptz)
`)
    : sql.raw(`
  coalesce(excluded.updated_at, '-infinity'::timestamptz) >
  coalesce(${tableName}.updated_at, '-infinity'::timestamptz)
`);
};

const newerKnowledgeWhere = sql.raw(`
  excluded.last_review > sync_knowledge.last_review
  or (
    excluded.last_review = sync_knowledge.last_review
    and coalesce(excluded.updated_at, excluded.created_at, '-infinity'::timestamptz) >
        coalesce(sync_knowledge.updated_at, sync_knowledge.created_at, '-infinity'::timestamptz)
  )
`);

const newerReviewLogWhere = sql.raw(`
  excluded.review > sync_review_logs.review
  or (
    excluded.review = sync_review_logs.review
    and coalesce(excluded.updated_at, excluded.created_at, excluded.review) >
        coalesce(sync_review_logs.updated_at, sync_review_logs.created_at, sync_review_logs.review)
  )
`);

const newerPermanentDeleteWhere = sql.raw(`
  excluded.deleted_at > sync_permanent_deletes.deleted_at
`);

const maybeConflictWhere = (
  condition: ReturnType<typeof sql.raw>,
  prefersLocal: boolean,
) => (prefersLocal ? {} : { setWhere: condition });

const getPullOffset = (
  input: SyncPullInput,
  key:
    | "deckFolders"
    | "decks"
    | "deckLinks"
    | "appSettings"
    | "permanentDeletes"
    | "knowledge"
    | "cards"
    | "knowledgeLinks"
    | "cardLinks"
    | "reviewLogs"
    | "reviewUndos",
) => input.offsets?.[key] ?? 0;

const syncPullKeys = [
  "deckFolders",
  "decks",
  "deckLinks",
  "appSettings",
  "permanentDeletes",
  "knowledge",
  "cards",
  "knowledgeLinks",
  "cardLinks",
  "reviewLogs",
  "reviewUndos",
] as const;

const loadPermanentDeleteEntityIds = async (
  tx: SyncTransaction,
  userId: string,
  entityType: string,
  entityIds: string[],
) => {
  if (entityIds.length === 0) {
    return new Set<string>();
  }

  const rows = await tx
    .select({
      entityId: syncPermanentDeletes.entityId,
    })
    .from(syncPermanentDeletes)
    .where(
      and(
        eq(syncPermanentDeletes.ownerId, userId),
        eq(syncPermanentDeletes.entityType, entityType),
        inArray(syncPermanentDeletes.entityId, [...new Set(entityIds)]),
      ),
    );

  return new Set(rows.map((row) => row.entityId));
};

const applyPermanentDeletes = async (
  tx: SyncTransaction,
  userId: string,
  deletes: SyncPushInput["permanentDeletes"],
) => {
  const groupedIds = new Map<string, string[]>();

  for (const item of deletes) {
    groupedIds.set(item.entityType, [
      ...(groupedIds.get(item.entityType) ?? []),
      item.entityId,
    ]);
  }

  const cardLinkIds = groupedIds.get("cardLink") ?? [];
  if (cardLinkIds.length > 0) {
    await tx
      .delete(syncCardLinks)
      .where(
        and(
          eq(syncCardLinks.ownerId, userId),
          inArray(syncCardLinks.id, [...new Set(cardLinkIds)]),
        ),
      );
  }

  const knowledgeLinkIds = groupedIds.get("knowledgeLink") ?? [];
  if (knowledgeLinkIds.length > 0) {
    await tx
      .delete(syncKnowledgeLinks)
      .where(
        and(
          eq(syncKnowledgeLinks.ownerId, userId),
          inArray(syncKnowledgeLinks.id, [...new Set(knowledgeLinkIds)]),
        ),
      );
  }

  const deckLinkIds = groupedIds.get("deckLink") ?? [];
  if (deckLinkIds.length > 0) {
    await tx
      .delete(syncDeckLinks)
      .where(
        and(
          eq(syncDeckLinks.ownerId, userId),
          inArray(syncDeckLinks.id, [...new Set(deckLinkIds)]),
        ),
      );
  }

  const cardIds = groupedIds.get("card") ?? [];
  if (cardIds.length > 0) {
    await tx
      .delete(syncCards)
      .where(
        and(
          eq(syncCards.ownerId, userId),
          inArray(syncCards.id, [...new Set(cardIds)]),
        ),
      );
  }

  const deckIds = groupedIds.get("deck") ?? [];
  if (deckIds.length > 0) {
    await tx
      .delete(syncDecks)
      .where(
        and(
          eq(syncDecks.ownerId, userId),
          inArray(syncDecks.id, [...new Set(deckIds)]),
        ),
      );
  }

  const folderIds = groupedIds.get("deckFolder") ?? [];
  if (folderIds.length > 0) {
    await tx
      .delete(syncDeckFolders)
      .where(
        and(
          eq(syncDeckFolders.ownerId, userId),
          inArray(syncDeckFolders.id, [...new Set(folderIds)]),
        ),
      );
  }

  const knowledgeIds = groupedIds.get("knowledge") ?? [];
  if (knowledgeIds.length > 0) {
    await tx
      .delete(syncKnowledge)
      .where(
        and(
          eq(syncKnowledge.ownerId, userId),
          inArray(syncKnowledge.id, [...new Set(knowledgeIds)]),
        ),
      );
  }
};

const upsertUserAndDevice = async (
  tx: SyncTransaction,
  userId: string,
  input: RegisterDeviceInput,
) => {
  await tx
    .insert(syncUsers)
    .values({
      id: userId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: syncUsers.id,
      set: {
        updatedAt: new Date(),
      },
    });

  await tx
    .insert(syncDevices)
    .values({
      userId,
      id: input.deviceId,
      platform: input.platform ?? null,
      appVersion: input.appVersion ?? null,
      syncMode: input.syncMode,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [syncDevices.userId, syncDevices.id],
      set: {
        platform: input.platform ?? null,
        appVersion: input.appVersion ?? null,
        syncMode: input.syncMode,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    });
};

export const registerDevice = async (
  userId: string,
  input: RegisterDeviceInput,
) => {
  await db.transaction(async (tx) => {
    await upsertUserAndDevice(tx, userId, input);
  });

  return {
    ok: true as const,
    userId,
    deviceId: input.deviceId,
    serverTime: new Date().toISOString(),
  };
};

export const pushSyncData = async (userId: string, input: SyncPushInput) => {
  const serverNow = new Date();
  const prefersLocal = input.conflictStrategy === "local";

  await db.transaction(async (tx) => {
    await upsertUserAndDevice(tx, userId, {
      deviceId: input.deviceId,
      syncMode: input.syncMode,
      conflictStrategy: input.conflictStrategy,
    });

    if (input.deckFolders.length > 0) {
      const deletedDeckFolderIds = await loadPermanentDeleteEntityIds(
        tx,
        userId,
        "deckFolder",
        input.deckFolders.map((folder) => folder.id),
      );
      const deletedParentFolderIds = await loadPermanentDeleteEntityIds(
        tx,
        userId,
        "deckFolder",
        input.deckFolders.flatMap((folder) =>
          folder.parentId ? [folder.parentId] : [],
        ),
      );
      const deckFoldersToUpsert = input.deckFolders.filter(
        (folder) => !deletedDeckFolderIds.has(folder.id),
      );

      if (deckFoldersToUpsert.length > 0) {
        await tx
          .insert(syncDeckFolders)
          .values(
            deckFoldersToUpsert.map((folder) => ({
              ownerId: userId,
              id: folder.id,
              name: folder.name,
              languageId: folder.languageId ?? null,
              parentId:
                folder.parentId && deletedParentFolderIds.has(folder.parentId)
                  ? null
                  : folder.parentId ?? null,
              newCardsPaused: folder.newCardsPaused,
              createdAt: toDate(folder.createdAt),
              updatedAt: toDate(folder.updatedAt),
              deletedAt: toDate(folder.deletedAt),
              serverUpdatedAt: serverNow,
            })),
          )
          .onConflictDoUpdate({
            target: [syncDeckFolders.ownerId, syncDeckFolders.id],
            set: {
              name: sql`excluded.name`,
              languageId: sql`excluded.language_id`,
              parentId: sql`excluded.parent_id`,
              newCardsPaused: sql`excluded.new_cards_paused`,
              createdAt: sql`excluded.created_at`,
              updatedAt: sql`excluded.updated_at`,
              deletedAt: sql`excluded.deleted_at`,
              serverUpdatedAt: serverNow,
            },
            ...maybeConflictWhere(
              newerEntityWhere("sync_deck_folders"),
              prefersLocal,
            ),
          });
      }
    }

    if (input.decks.length > 0) {
      const deletedDeckIds = await loadPermanentDeleteEntityIds(
        tx,
        userId,
        "deck",
        input.decks.map((deck) => deck.id),
      );
      const deletedFolderIds = await loadPermanentDeleteEntityIds(
        tx,
        userId,
        "deckFolder",
        input.decks.flatMap((deck) => (deck.folderId ? [deck.folderId] : [])),
      );
      const decksToUpsert = input.decks.filter(
        (deck) => !deletedDeckIds.has(deck.id),
      );

      if (decksToUpsert.length > 0) {
        await tx
          .insert(syncDecks)
          .values(
            decksToUpsert.map((deck) => ({
              ownerId: userId,
              id: deck.id,
              name: deck.name,
              visibility: deck.visibility,
              isStarred: deck.isStarred,
              folderId:
                deck.folderId && deletedFolderIds.has(deck.folderId)
                  ? null
                  : deck.folderId ?? null,
              languageId: deck.languageId ?? null,
              sourceReviewType: deck.sourceReviewType ?? null,
              primaryDeckId: deck.primaryDeckId ?? null,
              newCardsPaused: deck.newCardsPaused,
              createdAt: toDate(deck.createdAt),
              updatedAt: toDate(deck.updatedAt),
              deletedAt: toDate(deck.deletedAt),
              serverUpdatedAt: serverNow,
            })),
          )
          .onConflictDoUpdate({
            target: [syncDecks.ownerId, syncDecks.id],
            set: {
              name: sql`excluded.name`,
              visibility: sql`excluded.visibility`,
              isStarred: sql`excluded.is_starred`,
              folderId: sql`excluded.folder_id`,
              languageId: sql`excluded.language_id`,
              sourceReviewType: sql`excluded.source_review_type`,
              primaryDeckId: sql`excluded.primary_deck_id`,
              newCardsPaused: sql`excluded.new_cards_paused`,
              createdAt: sql`excluded.created_at`,
              updatedAt: sql`excluded.updated_at`,
              deletedAt: sql`excluded.deleted_at`,
              serverUpdatedAt: serverNow,
            },
            ...maybeConflictWhere(newerEntityWhere("sync_decks"), prefersLocal),
          });
      }
    }

    if (input.deckLinks.length > 0) {
      const deletedDeckLinkIds = await loadPermanentDeleteEntityIds(
        tx,
        userId,
        "deckLink",
        input.deckLinks.map((link) => link.id),
      );
      const deckLinksToUpsert = input.deckLinks.filter(
        (link) => !deletedDeckLinkIds.has(link.id),
      );

      if (deckLinksToUpsert.length > 0) {
        await tx
          .insert(syncDeckLinks)
          .values(
            deckLinksToUpsert.map((link) => ({
              ownerId: userId,
              id: link.id,
              primaryDeckId: link.primaryDeckId,
              linkedDeckId: link.linkedDeckId,
              targetReviewType: link.targetReviewType,
              createdAt: toDate(link.createdAt),
              updatedAt: toDate(link.updatedAt),
              serverUpdatedAt: serverNow,
            })),
          )
          .onConflictDoUpdate({
            target: [syncDeckLinks.ownerId, syncDeckLinks.id],
            set: {
              primaryDeckId: sql`excluded.primary_deck_id`,
              linkedDeckId: sql`excluded.linked_deck_id`,
              targetReviewType: sql`excluded.target_review_type`,
              createdAt: sql`excluded.created_at`,
              updatedAt: sql`excluded.updated_at`,
              serverUpdatedAt: serverNow,
            },
            ...maybeConflictWhere(newerEntityWhere("sync_deck_links"), prefersLocal),
          });
      }
    }

    if (input.appSettings.length > 0) {
      await tx
        .insert(syncAppSettings)
        .values(
          input.appSettings.map((setting) => ({
            ownerId: userId,
            key: setting.key,
            value: setting.value ?? null,
            updatedAt: toDate(setting.updatedAt),
            serverUpdatedAt: serverNow,
          })),
        )
        .onConflictDoUpdate({
          target: [syncAppSettings.ownerId, syncAppSettings.key],
          set: {
            value: sql`excluded.value`,
            updatedAt: sql`excluded.updated_at`,
            serverUpdatedAt: serverNow,
          },
          ...maybeConflictWhere(
            newerEntityWhere("sync_app_settings", { hasCreatedAt: false }),
            prefersLocal,
          ),
        });
    }

    if (input.permanentDeletes.length > 0) {
      await tx
        .insert(syncPermanentDeletes)
        .values(
          input.permanentDeletes.map((item) => ({
            ownerId: userId,
            id: item.id,
            entityType: item.entityType,
            entityId: item.entityId,
            deletedAt: new Date(item.deletedAt),
            serverUpdatedAt: serverNow,
          })),
        )
        .onConflictDoUpdate({
          target: [syncPermanentDeletes.ownerId, syncPermanentDeletes.id],
          set: {
            entityType: sql`excluded.entity_type`,
            entityId: sql`excluded.entity_id`,
            deletedAt: sql`excluded.deleted_at`,
            serverUpdatedAt: serverNow,
          },
          ...maybeConflictWhere(newerPermanentDeleteWhere, prefersLocal),
        });

      await applyPermanentDeletes(tx, userId, input.permanentDeletes);
    }

    if (input.knowledge.length > 0) {
      const deletedKnowledgeIds = await loadPermanentDeleteEntityIds(
        tx,
        userId,
        "knowledge",
        input.knowledge.map((item) => item.id),
      );
      const knowledgeToUpsert = input.knowledge.filter(
        (item) => !deletedKnowledgeIds.has(item.id),
      );

      if (knowledgeToUpsert.length > 0) {
        await tx
          .insert(syncKnowledge)
          .values(
            knowledgeToUpsert.map((item) => ({
              ownerId: userId,
              id: item.id,
              front: item.front,
              definitions: item.definitions,
              sourceDefinitions: item.sourceDefinitions ?? null,
              pronunciation: item.pronunciation ?? null,
              wordId: item.wordId ?? null,
              entryId: item.entryId ?? null,
              focus: item.focus ?? null,
              showFocus: item.showFocus,
              focusAllowsDuplicates: item.focusAllowsDuplicates,
              note: item.note ?? null,
              tags: item.tags ?? null,
              primaryPitchAccentDictionaryId:
                item.primaryPitchAccentDictionaryId ?? null,
              primaryPitchAccentReading: item.primaryPitchAccentReading ?? null,
              primaryPitchAccentAccentNumber:
                item.primaryPitchAccentAccentNumber ?? null,
              primaryPitchAccentIsCustom: item.primaryPitchAccentIsCustom ?? null,
              configSignature: item.configSignature,
              definitionConfig: item.definitionConfig ?? null,
              configLabel: item.configLabel ?? null,
              due: new Date(item.due),
              stability: item.stability,
              difficulty: item.difficulty,
              elapsedDays: item.elapsedDays,
              scheduledDays: item.scheduledDays,
              learningSteps: item.learningSteps,
              reps: item.reps,
              lapses: item.lapses,
              state: item.state,
              lastReview: new Date(item.lastReview),
              reviewType: item.reviewType,
              deleted: item.deleted,
              suspended: item.suspended,
              createdAt: toDate(item.createdAt),
              updatedAt: toDate(item.updatedAt),
              deletedAt: toDate(item.deletedAt),
              serverUpdatedAt: serverNow,
            })),
          )
          .onConflictDoUpdate({
            target: [syncKnowledge.ownerId, syncKnowledge.id],
            set: {
              front: sql`excluded.front`,
              definitions: sql`excluded.definitions`,
              sourceDefinitions: sql`excluded.source_definitions`,
              pronunciation: sql`excluded.pronunciation`,
              wordId: sql`excluded.word_id`,
              entryId: sql`excluded.entry_id`,
              focus: sql`excluded.focus`,
              showFocus: sql`excluded.show_focus`,
              focusAllowsDuplicates: sql`excluded.focus_allows_duplicates`,
              note: sql`excluded.note`,
              tags: sql`excluded.tags`,
              primaryPitchAccentDictionaryId:
                sql`excluded.primary_pitch_accent_dictionary_id`,
              primaryPitchAccentReading: sql`excluded.primary_pitch_accent_reading`,
              primaryPitchAccentAccentNumber:
                sql`excluded.primary_pitch_accent_accent_number`,
              primaryPitchAccentIsCustom:
                sql`excluded.primary_pitch_accent_is_custom`,
              configSignature: sql`excluded.config_signature`,
              definitionConfig: sql`excluded.definition_config`,
              configLabel: sql`excluded.config_label`,
              due: sql`excluded.due`,
              stability: sql`excluded.stability`,
              difficulty: sql`excluded.difficulty`,
              elapsedDays: sql`excluded.elapsed_days`,
              scheduledDays: sql`excluded.scheduled_days`,
              learningSteps: sql`excluded.learning_steps`,
              reps: sql`excluded.reps`,
              lapses: sql`excluded.lapses`,
              state: sql`excluded.state`,
              lastReview: sql`excluded.last_review`,
              reviewType: sql`excluded.review_type`,
              deleted: sql`excluded.deleted`,
              suspended: sql`excluded.suspended`,
              createdAt: sql`excluded.created_at`,
              updatedAt: sql`excluded.updated_at`,
              deletedAt: sql`excluded.deleted_at`,
              serverUpdatedAt: serverNow,
            },
            ...maybeConflictWhere(newerKnowledgeWhere, prefersLocal),
          });
      }
    }

    if (input.cards.length > 0) {
      const deletedCardIds = await loadPermanentDeleteEntityIds(
        tx,
        userId,
        "card",
        input.cards.map((card) => card.id),
      );
      const cardsToUpsert = input.cards.filter(
        (card) => !deletedCardIds.has(card.id),
      );

      if (cardsToUpsert.length > 0) {
        await tx
          .insert(syncCards)
          .values(
            cardsToUpsert.map((card) => ({
              ownerId: userId,
              id: card.id,
              deckId: card.deckId,
              knowledgeId: card.knowledgeId,
              note: card.note ?? null,
              tags: card.tags ?? null,
              createdAt: toDate(card.createdAt),
              updatedAt: toDate(card.updatedAt),
              deletedAt: toDate(card.deletedAt),
              serverUpdatedAt: serverNow,
            })),
          )
          .onConflictDoUpdate({
            target: [syncCards.ownerId, syncCards.id],
            set: {
              deckId: sql`excluded.deck_id`,
              knowledgeId: sql`excluded.knowledge_id`,
              note: sql`excluded.note`,
              tags: sql`excluded.tags`,
              createdAt: sql`excluded.created_at`,
              updatedAt: sql`excluded.updated_at`,
              deletedAt: sql`excluded.deleted_at`,
              serverUpdatedAt: serverNow,
            },
            ...maybeConflictWhere(newerEntityWhere("sync_cards"), prefersLocal),
          });
      }
    }

    if (input.knowledgeLinks.length > 0) {
      const deletedKnowledgeLinkIds = await loadPermanentDeleteEntityIds(
        tx,
        userId,
        "knowledgeLink",
        input.knowledgeLinks.map((link) => link.id),
      );
      const knowledgeLinksToUpsert = input.knowledgeLinks.filter(
        (link) => !deletedKnowledgeLinkIds.has(link.id),
      );

      if (knowledgeLinksToUpsert.length > 0) {
        await tx
          .insert(syncKnowledgeLinks)
          .values(
            knowledgeLinksToUpsert.map((link) => ({
              ownerId: userId,
              id: link.id,
              deckLinkId: link.deckLinkId,
              sourceKnowledgeId: link.sourceKnowledgeId,
              mirroredKnowledgeId: link.mirroredKnowledgeId,
              createdAt: toDate(link.createdAt),
              updatedAt: toDate(link.updatedAt),
              serverUpdatedAt: serverNow,
            })),
          )
          .onConflictDoUpdate({
            target: [syncKnowledgeLinks.ownerId, syncKnowledgeLinks.id],
            set: {
              deckLinkId: sql`excluded.deck_link_id`,
              sourceKnowledgeId: sql`excluded.source_knowledge_id`,
              mirroredKnowledgeId: sql`excluded.mirrored_knowledge_id`,
              createdAt: sql`excluded.created_at`,
              updatedAt: sql`excluded.updated_at`,
              serverUpdatedAt: serverNow,
            },
            ...maybeConflictWhere(
              newerEntityWhere("sync_knowledge_links"),
              prefersLocal,
            ),
          });
      }
    }

    if (input.cardLinks.length > 0) {
      const deletedCardLinkIds = await loadPermanentDeleteEntityIds(
        tx,
        userId,
        "cardLink",
        input.cardLinks.map((link) => link.id),
      );
      const cardLinksToUpsert = input.cardLinks.filter(
        (link) => !deletedCardLinkIds.has(link.id),
      );

      if (cardLinksToUpsert.length > 0) {
        await tx
          .insert(syncCardLinks)
          .values(
            cardLinksToUpsert.map((link) => ({
              ownerId: userId,
              id: link.id,
              deckLinkId: link.deckLinkId,
              sourceCardId: link.sourceCardId,
              mirroredCardId: link.mirroredCardId,
              createdAt: toDate(link.createdAt),
              updatedAt: toDate(link.updatedAt),
              serverUpdatedAt: serverNow,
            })),
          )
          .onConflictDoUpdate({
            target: [syncCardLinks.ownerId, syncCardLinks.id],
            set: {
              deckLinkId: sql`excluded.deck_link_id`,
              sourceCardId: sql`excluded.source_card_id`,
              mirroredCardId: sql`excluded.mirrored_card_id`,
              createdAt: sql`excluded.created_at`,
              updatedAt: sql`excluded.updated_at`,
              serverUpdatedAt: serverNow,
            },
            ...maybeConflictWhere(newerEntityWhere("sync_card_links"), prefersLocal),
          });
      }
    }

    if (input.reviewLogs.length > 0) {
      const deletedKnowledgeIds = await loadPermanentDeleteEntityIds(
        tx,
        userId,
        "knowledge",
        input.reviewLogs.map((log) => log.knowledgeId),
      );
      const reviewLogsToUpsert = input.reviewLogs.filter(
        (log) => !deletedKnowledgeIds.has(log.knowledgeId),
      );

      if (reviewLogsToUpsert.length > 0) {
        await tx
          .insert(syncReviewLogs)
          .values(
            reviewLogsToUpsert.map((log) => ({
              ownerId: userId,
              id: log.id,
              knowledgeId: log.knowledgeId,
              rating: log.rating ?? null,
              review: new Date(log.review),
              due: new Date(log.due),
              stability: log.stability,
              difficulty: log.difficulty,
              elapsedDays: log.elapsedDays,
              scheduledDays: log.scheduledDays,
              learningSteps: log.learningSteps,
              state: log.state,
              lastElapsedDays: log.lastElapsedDays,
              durationMs: log.durationMs,
              deleted: log.deleted,
              createdAt: toDate(log.createdAt) ?? new Date(log.review),
              updatedAt: toDate(log.updatedAt),
              serverUpdatedAt: serverNow,
            })),
          )
          .onConflictDoUpdate({
            target: [syncReviewLogs.ownerId, syncReviewLogs.id],
            set: {
              knowledgeId: sql`excluded.knowledge_id`,
              rating: sql`excluded.rating`,
              review: sql`excluded.review`,
              due: sql`excluded.due`,
              stability: sql`excluded.stability`,
              difficulty: sql`excluded.difficulty`,
              elapsedDays: sql`excluded.elapsed_days`,
              scheduledDays: sql`excluded.scheduled_days`,
              learningSteps: sql`excluded.learning_steps`,
              state: sql`excluded.state`,
              lastElapsedDays: sql`excluded.last_elapsed_days`,
              durationMs: sql`excluded.duration_ms`,
              deleted: sql`excluded.deleted`,
              createdAt: sql`excluded.created_at`,
              updatedAt: sql`excluded.updated_at`,
              serverUpdatedAt: serverNow,
            },
            ...maybeConflictWhere(newerReviewLogWhere, prefersLocal),
          });
      }
    }

    if (input.reviewUndos.length > 0) {
      const deletedKnowledgeIds = await loadPermanentDeleteEntityIds(
        tx,
        userId,
        "knowledge",
        input.reviewUndos.map((item) => item.knowledgeId),
      );
      const reviewUndosToUpsert = input.reviewUndos.filter(
        (item) => !deletedKnowledgeIds.has(item.knowledgeId),
      );

      if (reviewUndosToUpsert.length > 0) {
        await tx
          .insert(syncReviewUndos)
          .values(
            reviewUndosToUpsert.map((item) => ({
              ownerId: userId,
              id: item.id,
              knowledgeId: item.knowledgeId,
              reviewLogId: item.reviewLogId,
              due: new Date(item.due),
              stability: item.stability,
              difficulty: item.difficulty,
              elapsedDays: item.elapsedDays,
              scheduledDays: item.scheduledDays,
              learningSteps: item.learningSteps,
              reps: item.reps,
              lapses: item.lapses,
              state: item.state,
              lastReview: new Date(item.lastReview),
              undone: item.undone,
              invalidated: item.invalidated,
              createdAt: toDate(item.createdAt) ?? new Date(item.lastReview),
              updatedAt: toDate(item.updatedAt),
              serverUpdatedAt: serverNow,
            })),
          )
          .onConflictDoUpdate({
            target: [syncReviewUndos.ownerId, syncReviewUndos.id],
            set: {
              knowledgeId: sql`excluded.knowledge_id`,
              reviewLogId: sql`excluded.review_log_id`,
              due: sql`excluded.due`,
              stability: sql`excluded.stability`,
              difficulty: sql`excluded.difficulty`,
              elapsedDays: sql`excluded.elapsed_days`,
              scheduledDays: sql`excluded.scheduled_days`,
              learningSteps: sql`excluded.learning_steps`,
              reps: sql`excluded.reps`,
              lapses: sql`excluded.lapses`,
              state: sql`excluded.state`,
              lastReview: sql`excluded.last_review`,
              undone: sql`excluded.undone`,
              invalidated: sql`excluded.invalidated`,
              createdAt: sql`excluded.created_at`,
              updatedAt: sql`excluded.updated_at`,
              serverUpdatedAt: serverNow,
            },
            ...maybeConflictWhere(
              newerEntityWhere("sync_review_undos"),
              prefersLocal,
            ),
          });
      }
    }

    await tx
      .update(syncDevices)
      .set({
        syncMode: input.syncMode,
        lastSeenAt: serverNow,
        lastPushedAt: new Date(input.exportedAt),
        updatedAt: serverNow,
      })
      .where(
        and(
          eq(syncDevices.userId, userId),
          eq(syncDevices.id, input.deviceId),
        ),
      );
  });

  return {
    ok: true as const,
    serverTime: serverNow.toISOString(),
  };
};

export const pullSyncData = async (userId: string, input: SyncPullInput) => {
  const since = input.since ? new Date(input.since) : null;
  const upperBound = input.until ? new Date(input.until) : new Date();
  const limit = input.limitPerTable + 1;
  const buildPullWhere = (
    ownerIdColumn: any,
    serverUpdatedAtColumn: any,
  ) =>
    since
      ? and(
          eq(ownerIdColumn, userId),
          gt(serverUpdatedAtColumn, since),
          lte(serverUpdatedAtColumn, upperBound),
        )
      : and(eq(ownerIdColumn, userId), lte(serverUpdatedAtColumn, upperBound));
  const isInitialPage = syncPullKeys.every(
    (key) => getPullOffset(input, key) === 0,
  );

  const [
    rawDeckFolders,
    rawDecks,
    rawDeckLinks,
    rawAppSettings,
    rawPermanentDeletes,
    rawKnowledge,
    rawCards,
    rawKnowledgeLinks,
    rawCardLinks,
    rawReviewLogs,
    rawReviewUndos,
    totalCounts,
  ] = await Promise.all([
    db
      .select()
      .from(syncDeckFolders)
      .where(buildPullWhere(syncDeckFolders.ownerId, syncDeckFolders.serverUpdatedAt))
      .orderBy(asc(syncDeckFolders.serverUpdatedAt), asc(syncDeckFolders.id))
      .offset(getPullOffset(input, "deckFolders"))
      .limit(limit),
    db
      .select()
      .from(syncDecks)
      .where(buildPullWhere(syncDecks.ownerId, syncDecks.serverUpdatedAt))
      .orderBy(asc(syncDecks.serverUpdatedAt), asc(syncDecks.id))
      .offset(getPullOffset(input, "decks"))
      .limit(limit),
    db
      .select()
      .from(syncDeckLinks)
      .where(buildPullWhere(syncDeckLinks.ownerId, syncDeckLinks.serverUpdatedAt))
      .orderBy(asc(syncDeckLinks.serverUpdatedAt), asc(syncDeckLinks.id))
      .offset(getPullOffset(input, "deckLinks"))
      .limit(limit),
    db
      .select()
      .from(syncAppSettings)
      .where(buildPullWhere(syncAppSettings.ownerId, syncAppSettings.serverUpdatedAt))
      .orderBy(asc(syncAppSettings.serverUpdatedAt), asc(syncAppSettings.key))
      .offset(getPullOffset(input, "appSettings"))
      .limit(limit),
    db
      .select()
      .from(syncPermanentDeletes)
      .where(
        buildPullWhere(
          syncPermanentDeletes.ownerId,
          syncPermanentDeletes.serverUpdatedAt,
        ),
      )
      .orderBy(
        asc(syncPermanentDeletes.serverUpdatedAt),
        asc(syncPermanentDeletes.id),
      )
      .offset(getPullOffset(input, "permanentDeletes"))
      .limit(limit),
    db
      .select()
      .from(syncKnowledge)
      .where(buildPullWhere(syncKnowledge.ownerId, syncKnowledge.serverUpdatedAt))
      .orderBy(asc(syncKnowledge.serverUpdatedAt), asc(syncKnowledge.id))
      .offset(getPullOffset(input, "knowledge"))
      .limit(limit),
    db
      .select()
      .from(syncCards)
      .where(buildPullWhere(syncCards.ownerId, syncCards.serverUpdatedAt))
      .orderBy(asc(syncCards.serverUpdatedAt), asc(syncCards.id))
      .offset(getPullOffset(input, "cards"))
      .limit(limit),
    db
      .select()
      .from(syncKnowledgeLinks)
      .where(
        buildPullWhere(
          syncKnowledgeLinks.ownerId,
          syncKnowledgeLinks.serverUpdatedAt,
        ),
      )
      .orderBy(
        asc(syncKnowledgeLinks.serverUpdatedAt),
        asc(syncKnowledgeLinks.id),
      )
      .offset(getPullOffset(input, "knowledgeLinks"))
      .limit(limit),
    db
      .select()
      .from(syncCardLinks)
      .where(buildPullWhere(syncCardLinks.ownerId, syncCardLinks.serverUpdatedAt))
      .orderBy(asc(syncCardLinks.serverUpdatedAt), asc(syncCardLinks.id))
      .offset(getPullOffset(input, "cardLinks"))
      .limit(limit),
    db
      .select()
      .from(syncReviewLogs)
      .where(buildPullWhere(syncReviewLogs.ownerId, syncReviewLogs.serverUpdatedAt))
      .orderBy(asc(syncReviewLogs.serverUpdatedAt), asc(syncReviewLogs.id))
      .offset(getPullOffset(input, "reviewLogs"))
      .limit(limit),
    db
      .select()
      .from(syncReviewUndos)
      .where(buildPullWhere(syncReviewUndos.ownerId, syncReviewUndos.serverUpdatedAt))
      .orderBy(asc(syncReviewUndos.serverUpdatedAt), asc(syncReviewUndos.id))
      .offset(getPullOffset(input, "reviewUndos"))
      .limit(limit),
    isInitialPage
      ? Promise.all([
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(syncDeckFolders)
            .where(
              buildPullWhere(
                syncDeckFolders.ownerId,
                syncDeckFolders.serverUpdatedAt,
              ),
            ),
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(syncDecks)
            .where(buildPullWhere(syncDecks.ownerId, syncDecks.serverUpdatedAt)),
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(syncDeckLinks)
            .where(
              buildPullWhere(syncDeckLinks.ownerId, syncDeckLinks.serverUpdatedAt),
            ),
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(syncAppSettings)
            .where(
              buildPullWhere(syncAppSettings.ownerId, syncAppSettings.serverUpdatedAt),
            ),
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(syncPermanentDeletes)
            .where(
              buildPullWhere(
                syncPermanentDeletes.ownerId,
                syncPermanentDeletes.serverUpdatedAt,
              ),
            ),
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(syncKnowledge)
            .where(
              buildPullWhere(syncKnowledge.ownerId, syncKnowledge.serverUpdatedAt),
            ),
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(syncCards)
            .where(buildPullWhere(syncCards.ownerId, syncCards.serverUpdatedAt)),
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(syncKnowledgeLinks)
            .where(
              buildPullWhere(
                syncKnowledgeLinks.ownerId,
                syncKnowledgeLinks.serverUpdatedAt,
              ),
            ),
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(syncCardLinks)
            .where(
              buildPullWhere(syncCardLinks.ownerId, syncCardLinks.serverUpdatedAt),
            ),
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(syncReviewLogs)
            .where(
              buildPullWhere(syncReviewLogs.ownerId, syncReviewLogs.serverUpdatedAt),
            ),
          db
            .select({ count: sql<number>`cast(count(*) as int)` })
            .from(syncReviewUndos)
            .where(
              buildPullWhere(
                syncReviewUndos.ownerId,
                syncReviewUndos.serverUpdatedAt,
              ),
            ),
        ]).then(
          ([
            deckFoldersCount,
            decksCount,
            deckLinksCount,
            appSettingsCount,
            permanentDeletesCount,
            knowledgeCount,
            cardsCount,
            knowledgeLinksCount,
            cardLinksCount,
            reviewLogsCount,
            reviewUndosCount,
          ]) => ({
            deckFolders: deckFoldersCount[0]?.count ?? 0,
            decks: decksCount[0]?.count ?? 0,
            deckLinks: deckLinksCount[0]?.count ?? 0,
            appSettings: appSettingsCount[0]?.count ?? 0,
            permanentDeletes: permanentDeletesCount[0]?.count ?? 0,
            knowledge: knowledgeCount[0]?.count ?? 0,
            cards: cardsCount[0]?.count ?? 0,
            knowledgeLinks: knowledgeLinksCount[0]?.count ?? 0,
            cardLinks: cardLinksCount[0]?.count ?? 0,
            reviewLogs: reviewLogsCount[0]?.count ?? 0,
            reviewUndos: reviewUndosCount[0]?.count ?? 0,
          }),
        )
      : Promise.resolve(null),
  ]);

  const hasMore =
    rawDeckFolders.length > input.limitPerTable ||
    rawDecks.length > input.limitPerTable ||
    rawDeckLinks.length > input.limitPerTable ||
    rawAppSettings.length > input.limitPerTable ||
    rawPermanentDeletes.length > input.limitPerTable ||
    rawKnowledge.length > input.limitPerTable ||
    rawCards.length > input.limitPerTable ||
    rawKnowledgeLinks.length > input.limitPerTable ||
    rawCardLinks.length > input.limitPerTable ||
    rawReviewLogs.length > input.limitPerTable ||
    rawReviewUndos.length > input.limitPerTable;

  const deckFolders = rawDeckFolders.slice(0, input.limitPerTable);
  const decks = rawDecks.slice(0, input.limitPerTable);
  const deckLinks = rawDeckLinks.slice(0, input.limitPerTable);
  const appSettings = rawAppSettings.slice(0, input.limitPerTable);
  const permanentDeletes = rawPermanentDeletes.slice(0, input.limitPerTable);
  const knowledge = rawKnowledge.slice(0, input.limitPerTable);
  const cards = rawCards.slice(0, input.limitPerTable);
  const knowledgeLinks = rawKnowledgeLinks.slice(0, input.limitPerTable);
  const cardLinks = rawCardLinks.slice(0, input.limitPerTable);
  const reviewLogs = rawReviewLogs.slice(0, input.limitPerTable);
  const reviewUndos = rawReviewUndos.slice(0, input.limitPerTable);

  await db
    .update(syncDevices)
    .set({
      lastSeenAt: upperBound,
      lastPulledAt: upperBound,
      updatedAt: upperBound,
    })
    .where(
      and(eq(syncDevices.userId, userId), eq(syncDevices.id, input.deviceId)),
    );

  return {
    ok: true as const,
    serverTime: upperBound.toISOString(),
    cursor: upperBound.toISOString(),
    hasMore,
    totalCounts,
    deckFolders: deckFolders.map((row) => ({
      ...row,
      languageId: row.languageId ?? null,
    })),
    decks,
    deckLinks,
    appSettings,
    permanentDeletes,
    knowledge,
    cards,
    knowledgeLinks,
    cardLinks,
    reviewLogs,
    reviewUndos,
  };
};
