import { and, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { appSettings, cards, decks, decksFolders, knowledge, reviewLog } from "@/lib/database/schema";
import { markLocalChange } from "@/lib/sync/settings";

export type ReviewLimitSettings = {
	newLimitEnabled: boolean;
	newLimit: number | null;
	totalLimitEnabled: boolean;
	totalLimit: number | null;
};

export type ReviewLimitCounts = {
	newCount: number;
	totalCount: number;
};

export const REVIEW_LIMITS_DEFAULTS: ReviewLimitSettings = {
	newLimitEnabled: false,
	newLimit: null,
	totalLimitEnabled: false,
	totalLimit: null,
};

const GLOBAL_NEW_ENABLED_KEY = (languageId: string) =>
	`review_limits:${languageId}:global:new_enabled`;
const GLOBAL_NEW_LIMIT_KEY = (languageId: string) =>
	`review_limits:${languageId}:global:new_limit`;
const GLOBAL_TOTAL_ENABLED_KEY = (languageId: string) =>
	`review_limits:${languageId}:global:total_enabled`;
const GLOBAL_TOTAL_LIMIT_KEY = (languageId: string) =>
	`review_limits:${languageId}:global:total_limit`;

export const isGlobalReviewLimitSettingKey = (key: string) =>
	key.startsWith("review_limits:") && key.includes(":global:");

const normalizePositiveInteger = (value: number | null | undefined) => {
	if (!Number.isFinite(value ?? null)) {
		return null;
	}

	const parsed = Math.trunc(Number(value));
	return parsed > 0 ? parsed : null;
};

export const normalizeReviewLimitSettings = (
	input?: Partial<ReviewLimitSettings> | null,
): ReviewLimitSettings => {
	const newLimit = normalizePositiveInteger(input?.newLimit);
	const totalLimit = normalizePositiveInteger(input?.totalLimit);

	return {
		newLimitEnabled: Boolean(input?.newLimitEnabled) && newLimit !== null,
		newLimit,
		totalLimitEnabled: Boolean(input?.totalLimitEnabled) && totalLimit !== null,
		totalLimit,
	};
};

const toNullableSettingValue = (value: string | null | undefined) => value ?? null;

const parseBooleanSetting = (value: string | null | undefined) => value === "true";

const parseIntegerSetting = (value: string | null | undefined) => {
	if (!value) return null;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const getGlobalReviewLimitSettings = async (
	db: DrizzleInstance,
	languageId: string,
): Promise<ReviewLimitSettings> => {
	const rows = await db.query.appSettings.findMany({
		where: inArray(appSettings.key, [
			GLOBAL_NEW_ENABLED_KEY(languageId),
			GLOBAL_NEW_LIMIT_KEY(languageId),
			GLOBAL_TOTAL_ENABLED_KEY(languageId),
			GLOBAL_TOTAL_LIMIT_KEY(languageId),
		]),
	});
	const values = new Map(rows.map((row) => [row.key, row.value]));

	return normalizeReviewLimitSettings({
		newLimitEnabled: parseBooleanSetting(values.get(GLOBAL_NEW_ENABLED_KEY(languageId))),
		newLimit: parseIntegerSetting(values.get(GLOBAL_NEW_LIMIT_KEY(languageId))),
		totalLimitEnabled: parseBooleanSetting(values.get(GLOBAL_TOTAL_ENABLED_KEY(languageId))),
		totalLimit: parseIntegerSetting(values.get(GLOBAL_TOTAL_LIMIT_KEY(languageId))),
	});
};

export const setGlobalReviewLimitSettings = async (
	db: DrizzleInstance,
	languageId: string,
	input: ReviewLimitSettings,
) => {
	const normalized = normalizeReviewLimitSettings(input);
	const updatedAt = new Date().toISOString().replace("T", " ").replace("Z", "");
	const values = [
		{
			key: GLOBAL_NEW_ENABLED_KEY(languageId),
			value: normalized.newLimitEnabled ? "true" : "false",
		},
		{
			key: GLOBAL_NEW_LIMIT_KEY(languageId),
			value: normalized.newLimitEnabled ? String(normalized.newLimit) : null,
		},
		{
			key: GLOBAL_TOTAL_ENABLED_KEY(languageId),
			value: normalized.totalLimitEnabled ? "true" : "false",
		},
		{
			key: GLOBAL_TOTAL_LIMIT_KEY(languageId),
			value: normalized.totalLimitEnabled ? String(normalized.totalLimit) : null,
		},
	];

	for (const value of values) {
		await db
			.insert(appSettings)
			.values({
				key: value.key,
				value: toNullableSettingValue(value.value),
				updatedAt,
			})
			.onConflictDoUpdate({
				target: appSettings.key,
				set: {
					value: toNullableSettingValue(value.value),
					updatedAt,
				},
			});
	}

	await markLocalChange(db);
	return normalized;
};

const reviewDateSql = sql`date(datetime(replace(substr(${reviewLog.review}, 1, 19), 'T', ' ')), 'localtime')`;
const todayLocalDateSql = sql`date('now', 'localtime')`;

export const getDeckReviewCountsToday = async (
	db: DrizzleInstance,
	deckIds: string[],
): Promise<Map<string, ReviewLimitCounts>> => {
	const countsByDeckId = new Map<string, ReviewLimitCounts>();
	for (const deckId of deckIds) {
		countsByDeckId.set(deckId, { newCount: 0, totalCount: 0 });
	}

	if (deckIds.length === 0) {
		return countsByDeckId;
	}

	const rows = await db
		.select({
			deckId: cards.deckId,
			newCount: sql<number>`count(distinct case when ${reviewLog.state} = 'New' then ${reviewLog.id} end)`,
			totalCount: sql<number>`count(distinct ${reviewLog.id})`,
		})
		.from(cards)
		.innerJoin(knowledge, eq(cards.knowledgeId, knowledge.id))
		.innerJoin(reviewLog, eq(reviewLog.knowledgeId, knowledge.id))
		.where(
			and(
				inArray(cards.deckId, deckIds),
				eq(cards.deleted, false),
				eq(knowledge.deleted, false),
				eq(reviewLog.deleted, false),
				eq(reviewDateSql, todayLocalDateSql),
			),
		)
		.groupBy(cards.deckId);

	for (const row of rows) {
		countsByDeckId.set(row.deckId, {
			newCount: Number(row.newCount ?? 0),
			totalCount: Number(row.totalCount ?? 0),
		});
	}

	return countsByDeckId;
};

export const getFolderReviewCountsToday = async (
	db: DrizzleInstance,
	folderId: string,
): Promise<ReviewLimitCounts> => {
	const [row] = await db
		.select({
			newCount: sql<number>`count(distinct case when ${reviewLog.state} = 'New' then ${reviewLog.id} end)`,
			totalCount: sql<number>`count(distinct ${reviewLog.id})`,
		})
		.from(cards)
		.innerJoin(decks, eq(cards.deckId, decks.id))
		.innerJoin(knowledge, eq(cards.knowledgeId, knowledge.id))
		.innerJoin(reviewLog, eq(reviewLog.knowledgeId, knowledge.id))
		.where(
			and(
				eq(decks.folderId, folderId),
				eq(decks.deleted, false),
				eq(cards.deleted, false),
				eq(knowledge.deleted, false),
				eq(reviewLog.deleted, false),
				eq(reviewDateSql, todayLocalDateSql),
			),
		);

	return {
		newCount: Number(row?.newCount ?? 0),
		totalCount: Number(row?.totalCount ?? 0),
	};
};

export const getGlobalReviewCountsToday = async (
	db: DrizzleInstance,
	languageId: string,
): Promise<ReviewLimitCounts> => {
	const [row] = await db
		.select({
			newCount: sql<number>`count(distinct case when ${reviewLog.state} = 'New' then ${reviewLog.id} end)`,
			totalCount: sql<number>`count(distinct ${reviewLog.id})`,
		})
		.from(cards)
		.innerJoin(decks, eq(cards.deckId, decks.id))
		.innerJoin(knowledge, eq(cards.knowledgeId, knowledge.id))
		.innerJoin(reviewLog, eq(reviewLog.knowledgeId, knowledge.id))
		.where(
			and(
				eq(decks.languageId, languageId),
				eq(decks.deleted, false),
				eq(cards.deleted, false),
				eq(knowledge.deleted, false),
				eq(reviewLog.deleted, false),
				eq(reviewDateSql, todayLocalDateSql),
			),
		);

	return {
		newCount: Number(row?.newCount ?? 0),
		totalCount: Number(row?.totalCount ?? 0),
	};
};

export const countNewCards = (
	items: Array<{
		knowledge: {
			state: string;
		};
	}>,
) => items.filter((item) => item.knowledge.state === "New").length;

export const canAdmitReviewUnderLimit = ({
	settings,
	counts,
	isNew,
}: {
	settings: ReviewLimitSettings;
	counts: ReviewLimitCounts;
	isNew: boolean;
}) => {
	if (
		settings.totalLimitEnabled &&
		settings.totalLimit !== null &&
		counts.totalCount >= settings.totalLimit
	) {
		return false;
	}

	if (
		isNew &&
		settings.newLimitEnabled &&
		settings.newLimit !== null &&
		counts.newCount >= settings.newLimit
	) {
		return false;
	}

	return true;
};

export const incrementReviewLimitCounts = (
	counts: ReviewLimitCounts,
	isNew: boolean,
): ReviewLimitCounts => ({
	newCount: counts.newCount + (isNew ? 1 : 0),
	totalCount: counts.totalCount + 1,
});

export const decrementReviewLimitCounts = (
	counts: ReviewLimitCounts,
	isNew: boolean,
): ReviewLimitCounts => ({
	newCount: Math.max(0, counts.newCount - (isNew ? 1 : 0)),
	totalCount: Math.max(0, counts.totalCount - 1),
});

export const getDeckReviewLimitSettings = (
	deck: Pick<
		typeof decks.$inferSelect,
		| "dailyNewLimitEnabled"
		| "dailyNewLimit"
		| "dailyReviewLimitEnabled"
		| "dailyReviewLimit"
	>,
): ReviewLimitSettings =>
	normalizeReviewLimitSettings({
		newLimitEnabled: Boolean(deck.dailyNewLimitEnabled),
		newLimit: deck.dailyNewLimit,
		totalLimitEnabled: Boolean(deck.dailyReviewLimitEnabled),
		totalLimit: deck.dailyReviewLimit,
	});

export const getFolderReviewLimitSettings = (
	folder: Pick<
		typeof decksFolders.$inferSelect,
		| "dailyNewLimitEnabled"
		| "dailyNewLimit"
		| "dailyReviewLimitEnabled"
		| "dailyReviewLimit"
	>,
): ReviewLimitSettings =>
	normalizeReviewLimitSettings({
		newLimitEnabled: Boolean(folder.dailyNewLimitEnabled),
		newLimit: folder.dailyNewLimit,
		totalLimitEnabled: Boolean(folder.dailyReviewLimitEnabled),
		totalLimit: folder.dailyReviewLimit,
	});
