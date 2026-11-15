import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { cards, decks, knowledge, reviewLog } from "@/lib/database/schema";
import type { VisibleReviewType } from "@/lib/review/reviewTypeConfig";

const reviewDateSql = sql<string>`date(datetime(replace(substr(${reviewLog.review}, 1, 19), 'T', ' ')), 'localtime')`;

export interface TodayReviewStats {
	newReviewedToday: number;
	totalReviewedToday: number;
}

export interface ReviewHistoryStat {
	date: string;
	newReviewedCount: number;
	totalReviewedCount: number;
}

export type StatsReviewTypeFilter = VisibleReviewType | null;

const formatLocalDateKey = (value: Date) => {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, "0");
	const day = String(value.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
};

const startOfLocalDay = (value: Date) =>
	new Date(value.getFullYear(), value.getMonth(), value.getDate());

const shiftLocalDays = (value: Date, days: number) => {
	const shifted = new Date(value);
	shifted.setDate(shifted.getDate() + days);
	return shifted;
};

const buildDateWindow = (days: number, now = new Date()) => {
	const normalizedDays = Math.max(1, Math.trunc(days));
	const end = startOfLocalDay(now);
	const start = shiftLocalDays(end, -(normalizedDays - 1));

	return {
		days: normalizedDays,
		start,
		end,
		startKey: formatLocalDateKey(start),
		endKey: formatLocalDateKey(end),
	};
};

export const getTodayReviewStats = async (
	db: DrizzleInstance,
	languageId: string,
	reviewType: StatsReviewTypeFilter = null,
): Promise<TodayReviewStats> => {
	const todayLocalDateSql = sql`date('now', 'localtime')`;
	const baseWhere = and(
		eq(decks.languageId, languageId),
		eq(decks.deleted, false),
		eq(cards.deleted, false),
		eq(knowledge.deleted, false),
		eq(reviewLog.deleted, false),
		eq(reviewDateSql, todayLocalDateSql),
	);
	const whereClause = reviewType
		? and(baseWhere, eq(knowledge.reviewType, reviewType))
		: baseWhere;
	const [row] = await db
		.select({
			newReviewedToday:
				sql<number>`count(distinct case when ${reviewLog.state} = 'New' then ${reviewLog.id} end)`,
			totalReviewedToday: sql<number>`count(distinct ${reviewLog.id})`,
		})
		.from(cards)
		.innerJoin(decks, eq(cards.deckId, decks.id))
		.innerJoin(knowledge, eq(cards.knowledgeId, knowledge.id))
		.innerJoin(reviewLog, eq(reviewLog.knowledgeId, knowledge.id))
		.where(whereClause);

	return {
		newReviewedToday: Number(row?.newReviewedToday ?? 0),
		totalReviewedToday: Number(row?.totalReviewedToday ?? 0),
	};
};

export const getReviewHistoryStats = async (
	db: DrizzleInstance,
	languageId: string,
	days: number,
	now = new Date(),
	reviewType: StatsReviewTypeFilter = null,
): Promise<ReviewHistoryStat[]> => {
	const window = buildDateWindow(days, now);
	const baseWhere = and(
		eq(decks.languageId, languageId),
		eq(decks.deleted, false),
		eq(cards.deleted, false),
		eq(knowledge.deleted, false),
		eq(reviewLog.deleted, false),
		gte(reviewDateSql, window.startKey),
		lte(reviewDateSql, window.endKey),
	);
	const whereClause = reviewType
		? and(baseWhere, eq(knowledge.reviewType, reviewType))
		: baseWhere;

	const rows = await db
		.select({
			date: reviewDateSql,
			newReviewedCount:
				sql<number>`count(distinct case when ${reviewLog.state} = 'New' then ${reviewLog.id} end)`,
			totalReviewedCount: sql<number>`count(distinct ${reviewLog.id})`,
		})
		.from(cards)
		.innerJoin(decks, eq(cards.deckId, decks.id))
		.innerJoin(knowledge, eq(cards.knowledgeId, knowledge.id))
		.innerJoin(reviewLog, eq(reviewLog.knowledgeId, knowledge.id))
		.where(whereClause)
		.groupBy(reviewDateSql);

	const countsByDate = new Map(
		rows.map((row) => [
			row.date,
			{
				newReviewedCount: Number(row.newReviewedCount ?? 0),
				totalReviewedCount: Number(row.totalReviewedCount ?? 0),
			},
		]),
	);

	return Array.from({ length: window.days }, (_, index) => {
		const date = shiftLocalDays(window.start, index);
		const key = formatLocalDateKey(date);
		const counts = countsByDate.get(key);

		return {
			date: key,
			newReviewedCount: counts?.newReviewedCount ?? 0,
			totalReviewedCount: counts?.totalReviewedCount ?? 0,
		};
	});
};

export const getKnownCardsCount = async (
	db: DrizzleInstance,
	languageId: string,
	reviewType: StatsReviewTypeFilter = null,
) => {
	const baseWhere = and(
		eq(decks.languageId, languageId),
		eq(decks.deleted, false),
		eq(cards.deleted, false),
		eq(knowledge.deleted, false),
		eq(knowledge.suspended, false),
		eq(knowledge.state, "Review"),
	);
	const whereClause = reviewType
		? and(baseWhere, eq(knowledge.reviewType, reviewType))
		: baseWhere;
	const [row] = await db
		.select({
			knownCardsCount: sql<number>`count(distinct ${knowledge.id})`,
		})
		.from(cards)
		.innerJoin(decks, eq(cards.deckId, decks.id))
		.innerJoin(knowledge, eq(cards.knowledgeId, knowledge.id))
		.where(whereClause);

	return Number(row?.knownCardsCount ?? 0);
};
