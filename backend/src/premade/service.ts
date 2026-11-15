import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "../db/client";
import { premadeDecks, premadeItems } from "../db/schema";
import type { PremadeListQuery, PremadePullQuery } from "./schema";

type PremadeChangeKind = "deck" | "item" | "watermark";

type PremadeCursor = {
  updatedAt: string;
  kind: PremadeChangeKind;
  id: string;
};

type PremadeDeckRecord = {
  id: string;
  slug: string;
  name: string;
  book: string;
  lesson: number;
  languageId: string;
  source: string;
  isPublished: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  serverUpdatedAt: string;
};

type PremadeItemRecord = {
  id: string;
  premadeDeckId: string;
  sortOrder: number;
  sourceTag: string;
  kana: string | null;
  kanji: string | null;
  english: string;
  front: string;
  pronunciation: string | null;
  sourceDefinitions: string;
  dictionaryEntryId: string | null;
  dictionarySenseIds: string[];
  usesAllSenses: boolean;
  matchStatus: string | null;
  matchMethod: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  serverUpdatedAt: string;
};

type PremadeDeckChange = PremadeDeckRecord & {
  changeKind: "deck";
};

type PremadeItemChange = PremadeItemRecord & {
  changeKind: "item";
};

type PremadeChange = PremadeDeckChange | PremadeItemChange;

const cursorKindRank: Record<PremadeChangeKind, number> = {
  deck: 0,
  item: 1,
  watermark: 2,
};

const normalizeTimestamp = (value: Date | string | null | undefined) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const encodeCursor = (cursor: PremadeCursor) =>
  Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");

const decodeCursor = (value: string | undefined): PremadeCursor | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf-8")) as {
      updatedAt?: unknown;
      kind?: unknown;
      id?: unknown;
    };

    if (
      typeof parsed.updatedAt !== "string" ||
      normalizeTimestamp(parsed.updatedAt) === null ||
      (parsed.kind !== "deck" && parsed.kind !== "item" && parsed.kind !== "watermark") ||
      typeof parsed.id !== "string"
    ) {
      return null;
    }

    return {
      updatedAt: normalizeTimestamp(parsed.updatedAt)!,
      kind: parsed.kind,
      id: parsed.id,
    };
  } catch {
    return null;
  }
};

const compareCursor = (left: PremadeCursor, right: PremadeCursor) => {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt.localeCompare(right.updatedAt);
  }

  const leftRank = cursorKindRank[left.kind];
  const rightRank = cursorKindRank[right.kind];
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return left.id.localeCompare(right.id);
};

const isAfterCursor = (change: PremadeCursor, cursor: PremadeCursor | null) => {
  if (!cursor) {
    return true;
  }

  return compareCursor(change, cursor) > 0;
};

const getDeckChangeCursor = (deck: PremadeDeckRecord): PremadeCursor => ({
  updatedAt: deck.serverUpdatedAt,
  kind: "deck",
  id: deck.id,
});

const getItemChangeCursor = (item: PremadeItemRecord): PremadeCursor => ({
  updatedAt: item.serverUpdatedAt,
  kind: "item",
  id: item.id,
});

const getWatermarkCursor = (serverNow: string): PremadeCursor => ({
  updatedAt: serverNow,
  kind: "watermark",
  id: "",
});

const normalizeDeckRecord = (row: typeof premadeDecks.$inferSelect): PremadeDeckRecord => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  book: row.book,
  lesson: row.lesson,
  languageId: row.languageId,
  source: row.source,
  isPublished: row.isPublished,
  deletedAt: normalizeTimestamp(row.deletedAt),
  createdAt: normalizeTimestamp(row.createdAt) ?? new Date(0).toISOString(),
  updatedAt: normalizeTimestamp(row.updatedAt) ?? new Date(0).toISOString(),
  serverUpdatedAt:
    normalizeTimestamp(row.serverUpdatedAt) ??
    normalizeTimestamp(row.updatedAt) ??
    new Date(0).toISOString(),
});

const normalizeItemRecord = (row: typeof premadeItems.$inferSelect): PremadeItemRecord => ({
  id: row.id,
  premadeDeckId: row.premadeDeckId,
  sortOrder: row.sortOrder,
  sourceTag: row.sourceTag,
  kana: row.kana ?? null,
  kanji: row.kanji ?? null,
  english: row.english,
  front: row.front,
  pronunciation: row.pronunciation ?? null,
  sourceDefinitions: row.sourceDefinitions,
  dictionaryEntryId: row.dictionaryEntryId ?? null,
  dictionarySenseIds: Array.isArray(row.dictionarySenseIds)
    ? row.dictionarySenseIds.filter((value): value is string => typeof value === "string")
    : [],
  usesAllSenses: row.usesAllSenses,
  matchStatus: row.matchStatus ?? null,
  matchMethod: row.matchMethod ?? null,
  deletedAt: normalizeTimestamp(row.deletedAt),
  createdAt: normalizeTimestamp(row.createdAt) ?? new Date(0).toISOString(),
  updatedAt: normalizeTimestamp(row.updatedAt) ?? new Date(0).toISOString(),
  serverUpdatedAt:
    normalizeTimestamp(row.serverUpdatedAt) ??
    normalizeTimestamp(row.updatedAt) ??
    new Date(0).toISOString(),
});

export const listPremadeDecks = async (query: PremadeListQuery) => {
  const deckRows = await db.query.premadeDecks.findMany({
    where: query.languageId
      ? and(
          eq(premadeDecks.languageId, query.languageId),
          eq(premadeDecks.isPublished, true),
          isNull(premadeDecks.deletedAt),
        )
      : and(eq(premadeDecks.isPublished, true), isNull(premadeDecks.deletedAt)),
    orderBy: [asc(premadeDecks.book), asc(premadeDecks.lesson), asc(premadeDecks.name)],
  });

  return deckRows.map((row) => {
    const normalized = normalizeDeckRecord(row);
    const { serverUpdatedAt: _serverUpdatedAt, ...visible } = normalized;
    return visible;
  });
};

export const pullPremadeContent = async (query: PremadePullQuery) => {
  const serverNow = new Date().toISOString();
  const cursor = decodeCursor(query.cursor);

  const deckRows = await db.query.premadeDecks.findMany({
    where: query.languageId
      ? and(
          eq(premadeDecks.languageId, query.languageId),
          lte(premadeDecks.serverUpdatedAt, new Date(serverNow)),
        )
      : lte(premadeDecks.serverUpdatedAt, new Date(serverNow)),
    orderBy: [asc(premadeDecks.serverUpdatedAt), asc(premadeDecks.id)],
  });

  const itemRows = await db
    .select({
      item: premadeItems,
    })
    .from(premadeItems)
    .innerJoin(premadeDecks, eq(premadeItems.premadeDeckId, premadeDecks.id))
    .where(
      and(
        query.languageId ? eq(premadeDecks.languageId, query.languageId) : undefined,
        lte(premadeItems.serverUpdatedAt, new Date(serverNow)),
        eq(premadeDecks.isPublished, true),
        isNull(premadeDecks.deletedAt),
      ),
    );

  const deckChanges = deckRows
    .map(normalizeDeckRecord)
    .filter((row) => isAfterCursor(getDeckChangeCursor(row), cursor))
    .map((row) => ({
      ...row,
      changeKind: "deck" as const,
    }));

  const itemChanges = itemRows
    .map(({ item }) => normalizeItemRecord(item))
    .filter((row) => isAfterCursor(getItemChangeCursor(row), cursor))
    .map((row) => ({
      ...row,
      changeKind: "item" as const,
    }));

  const allChanges = [...deckChanges, ...itemChanges].sort((left, right) =>
    compareCursor(
      left.changeKind === "deck" ? getDeckChangeCursor(left) : getItemChangeCursor(left),
      right.changeKind === "deck" ? getDeckChangeCursor(right) : getItemChangeCursor(right),
    ),
  );

  const page = allChanges.slice(0, query.limit);
  const hasMore = allChanges.length > page.length;
  const lastChange = page.at(-1);

  const nextCursor = encodeCursor(
    lastChange
      ? lastChange.changeKind === "deck"
        ? getDeckChangeCursor(lastChange)
        : getItemChangeCursor(lastChange)
      : getWatermarkCursor(serverNow),
  );

  return {
    cursor: hasMore ? nextCursor : encodeCursor(getWatermarkCursor(serverNow)),
    hasMore,
    serverTime: serverNow,
    premadeDecks: page
      .filter((change): change is PremadeDeckChange => change.changeKind === "deck")
      .map(({ changeKind: _changeKind, serverUpdatedAt: _serverUpdatedAt, ...deck }) => deck),
    premadeItems: page
      .filter((change): change is PremadeItemChange => change.changeKind === "item")
      .map(({ changeKind: _changeKind, serverUpdatedAt: _serverUpdatedAt, ...item }) => item),
  };
};
