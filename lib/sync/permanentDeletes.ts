import { inArray, sql } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import {
  cardLinks,
  cards,
  deckLinks,
  decks,
  decksFolders,
  knowledge,
  knowledgeLinks,
  permanentDeletes,
  type PermanentDeleteEntityType,
} from "@/lib/database/schema";

export type PermanentDeleteRecord = typeof permanentDeletes.$inferSelect;

const PERMANENT_DELETE_UPSERT_CHUNK_SIZE = 250;

export const buildPermanentDeleteId = (
  entityType: PermanentDeleteEntityType,
  entityId: string,
) => `${entityType}:${entityId}`;

export const createPermanentDeleteRecord = ({
  entityType,
  entityId,
  deletedAt,
}: {
  entityType: PermanentDeleteEntityType;
  entityId: string;
  deletedAt: string;
}): PermanentDeleteRecord => ({
  id: buildPermanentDeleteId(entityType, entityId),
  entityType,
  entityId,
  deletedAt,
});

const dedupePermanentDeletes = (records: PermanentDeleteRecord[]) => {
  const next = new Map<string, PermanentDeleteRecord>();

  for (const record of records) {
    const current = next.get(record.id);
    if (!current || current.deletedAt < record.deletedAt) {
      next.set(record.id, record);
    }
  }

  return [...next.values()];
};

export const upsertPermanentDeletes = async (
  db: DrizzleInstance,
  records: PermanentDeleteRecord[],
) => {
  const nextRecords = dedupePermanentDeletes(records);

  for (let index = 0; index < nextRecords.length; index += PERMANENT_DELETE_UPSERT_CHUNK_SIZE) {
    const chunk = nextRecords.slice(index, index + PERMANENT_DELETE_UPSERT_CHUNK_SIZE);

    await db
      .insert(permanentDeletes)
      .values(chunk)
      .onConflictDoUpdate({
        target: permanentDeletes.id,
        set: {
          entityType: sql`excluded.entity_type`,
          entityId: sql`excluded.entity_id`,
          deletedAt: sql`excluded.deleted_at`,
        },
      });
  }
};

export const applyPermanentDeletes = async (
  db: DrizzleInstance,
  records: PermanentDeleteRecord[],
) => {
  const nextRecords = dedupePermanentDeletes(records);

  if (nextRecords.length === 0) {
    return 0;
  }

  await upsertPermanentDeletes(db, nextRecords);

  const idsByType = new Map<PermanentDeleteEntityType, string[]>();
  for (const record of nextRecords) {
    idsByType.set(record.entityType, [
      ...(idsByType.get(record.entityType) ?? []),
      record.entityId,
    ]);
  }

  const cardLinkIds = idsByType.get("cardLink") ?? [];
  if (cardLinkIds.length > 0) {
    await db.delete(cardLinks).where(inArray(cardLinks.id, cardLinkIds));
  }

  const knowledgeLinkIds = idsByType.get("knowledgeLink") ?? [];
  if (knowledgeLinkIds.length > 0) {
    await db
      .delete(knowledgeLinks)
      .where(inArray(knowledgeLinks.id, knowledgeLinkIds));
  }

  const deckLinkIds = idsByType.get("deckLink") ?? [];
  if (deckLinkIds.length > 0) {
    await db.delete(deckLinks).where(inArray(deckLinks.id, deckLinkIds));
  }

  const cardIds = idsByType.get("card") ?? [];
  if (cardIds.length > 0) {
    await db.delete(cards).where(inArray(cards.id, cardIds));
  }

  const deckIds = idsByType.get("deck") ?? [];
  if (deckIds.length > 0) {
    await db.delete(decks).where(inArray(decks.id, deckIds));
  }

  const folderIds = idsByType.get("deckFolder") ?? [];
  if (folderIds.length > 0) {
    await db.delete(decksFolders).where(inArray(decksFolders.id, folderIds));
  }

  const knowledgeIds = idsByType.get("knowledge") ?? [];
  if (knowledgeIds.length > 0) {
    await db.delete(knowledge).where(inArray(knowledge.id, knowledgeIds));
  }

  return nextRecords.length;
};
