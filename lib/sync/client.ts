import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import {
	clearFsrsEngineCache,
	clearReviewEntryDetailCache,
} from "@/lib/review/fsrs";
import {
	exportUserSyncSnapshot,
	type UserSyncSnapshot,
} from "@/lib/sync/export";
import { importPulledSyncData, type SyncPullPayload } from "@/lib/sync/import";
import {
	getSyncSettingsSnapshot,
	markSyncPull,
	markSyncPush,
} from "@/lib/sync/settings";
import { appendSyncDebugEvent } from "@/lib/sync/debug";

export type SyncConflictStrategy = "remote" | "local";

const resolveSyncApiBaseUrl = () => {
	const configuredUrl = process.env.EXPO_PUBLIC_SYNC_API_URL?.trim();

	if (!configuredUrl) {
		throw new Error(
			"Add EXPO_PUBLIC_SYNC_API_URL to the .env file before using cloud sync.",
		);
	}

	const normalizedUrl = configuredUrl.replace(/\/$/, "");

	return normalizedUrl.endsWith("/api/v1/sync")
		? normalizedUrl
		: `${normalizedUrl}/api/v1/sync`;
};

const postSyncJson = async <TResponse>(
	path: string,
	token: string,
	body: unknown,
): Promise<TResponse> => {
	const response = await fetch(`${resolveSyncApiBaseUrl()}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	const payload = (await response.json().catch(() => null)) as
		| TResponse
		| { error?: string }
		| null;

	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload
				? payload.error
				: null;

		throw new Error(message ?? `Sync request failed with status ${response.status}.`);
	}

	return payload as TResponse;
};

interface RegisterSyncDeviceResponse {
	ok: true;
	userId: string;
	deviceId: string;
	serverTime: string;
}

interface PushSyncDataResponse {
	ok: true;
	serverTime: string;
}

interface PullSyncDataResponse extends SyncPullPayload {
	ok: true;
	serverTime: string;
	cursor: string;
	hasMore: boolean;
	totalCounts: Record<SyncTableKey, number> | null;
}

export interface ManualSyncConflictSummary {
	total: number;
	deckFolders: number;
	decks: number;
	deckLinks: number;
	appSettings: number;
	permanentDeletes: number;
	knowledge: number;
	cards: number;
	knowledgeLinks: number;
	cardLinks: number;
	reviewLogs: number;
	reviewUndos: number;
}

export interface ManualSyncChangeSummary {
	total: number;
	deckFolders: number;
	decks: number;
	deckLinks: number;
	appSettings: number;
	permanentDeletes: number;
	knowledge: number;
	cards: number;
	knowledgeLinks: number;
	cardLinks: number;
	reviewLogs: number;
	reviewUndos: number;
}

export interface ManualSyncResult {
	serverTime: string;
	localChanges: ManualSyncChangeSummary;
	remoteChanges: ManualSyncChangeSummary;
}

export interface ManualSyncConflictResult {
	requiresConflictResolution: true;
	conflicts: ManualSyncConflictSummary;
}

export interface ManualSyncProgress {
	label: string;
	completed: number;
	total: number;
}

type SyncTableKey =
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
	| "reviewUndos";

type SyncPullOffsets = Record<SyncTableKey, number>;

const PUSH_BATCH_SIZE = 500;
const PULL_LIMIT_PER_TABLE = 1000;

const EMPTY_PULL_OFFSETS: SyncPullOffsets = {
	deckFolders: 0,
	decks: 0,
	deckLinks: 0,
	appSettings: 0,
	permanentDeletes: 0,
	knowledge: 0,
	cards: 0,
	knowledgeLinks: 0,
	cardLinks: 0,
	reviewLogs: 0,
	reviewUndos: 0,
};

const emptySyncPayload = (): SyncPullPayload => ({
	deckFolders: [],
	decks: [],
	deckLinks: [],
	appSettings: [],
	permanentDeletes: [],
	knowledge: [],
	cards: [],
	knowledgeLinks: [],
	cardLinks: [],
	reviewLogs: [],
	reviewUndos: [],
});

const toEpoch = (value: string | null | undefined) => {
	if (!value) return null;
	const parsed = new Date(value).getTime();
	return Number.isNaN(parsed) ? null : parsed;
};

const changedSince = (value: string | null | undefined, since: string | null) => {
	if (!since) return true;

	const currentTime = toEpoch(value);
	const sinceTime = toEpoch(since);

	if (currentTime === null || sinceTime === null) {
		return false;
	}

	return currentTime > sinceTime;
};

const deckFolderUpdatedAt = (item: UserSyncSnapshot["deckFolders"][number]) =>
	item.updatedAt ?? item.createdAt;

const deckUpdatedAt = (item: UserSyncSnapshot["decks"][number]) =>
	item.updatedAt ?? item.createdAt;

const deckLinkUpdatedAt = (item: UserSyncSnapshot["deckLinks"][number]) =>
	item.updatedAt ?? item.createdAt;

const permanentDeleteUpdatedAt = (
	item: UserSyncSnapshot["permanentDeletes"][number],
) => item.deletedAt;

const knowledgeUpdatedAt = (item: UserSyncSnapshot["knowledge"][number]) =>
	item.lastReview ?? item.updatedAt ?? item.createdAt;

const cardUpdatedAt = (item: UserSyncSnapshot["cards"][number]) =>
	item.updatedAt ?? item.createdAt;

const knowledgeLinkUpdatedAt = (item: UserSyncSnapshot["knowledgeLinks"][number]) =>
	item.updatedAt ?? item.createdAt;

const cardLinkUpdatedAt = (item: UserSyncSnapshot["cardLinks"][number]) =>
	item.updatedAt ?? item.createdAt;

const reviewLogUpdatedAt = (item: UserSyncSnapshot["reviewLogs"][number]) =>
	item.updatedAt ?? item.createdAt ?? item.review;

const reviewUndoUpdatedAt = (item: UserSyncSnapshot["reviewUndos"][number]) =>
	item.updatedAt ?? item.createdAt ?? item.lastReview;

const filterChangedItems = <T>(
	items: T[],
	since: string | null,
	getUpdatedAt: (item: T) => string | null | undefined,
) => items.filter((item) => changedSince(getUpdatedAt(item), since));

export const buildChangedSnapshot = (
	snapshot: UserSyncSnapshot,
	since: string | null,
): SyncPullPayload => ({
	deckFolders: filterChangedItems(snapshot.deckFolders, since, deckFolderUpdatedAt),
	decks: filterChangedItems(snapshot.decks, since, deckUpdatedAt),
	deckLinks: filterChangedItems(snapshot.deckLinks, since, deckLinkUpdatedAt),
	appSettings: filterChangedItems(snapshot.appSettings, since, (item) => item.updatedAt),
	permanentDeletes: filterChangedItems(
		snapshot.permanentDeletes,
		since,
		permanentDeleteUpdatedAt,
	),
	knowledge: filterChangedItems(snapshot.knowledge, since, knowledgeUpdatedAt),
	cards: filterChangedItems(snapshot.cards, since, cardUpdatedAt),
	knowledgeLinks: filterChangedItems(
		snapshot.knowledgeLinks,
		since,
		knowledgeLinkUpdatedAt,
	),
	cardLinks: filterChangedItems(snapshot.cardLinks, since, cardLinkUpdatedAt),
	reviewLogs: filterChangedItems(snapshot.reviewLogs, since, reviewLogUpdatedAt),
	reviewUndos: filterChangedItems(snapshot.reviewUndos, since, reviewUndoUpdatedAt),
});

const getSyncItemId = (key: SyncTableKey, item: Record<string, unknown>) => {
	switch (key) {
		case "appSettings":
			return String(item.key);
		default:
			return String(item.id);
	}
};

const getSyncItemUpdatedAt = (
	key: SyncTableKey,
	item: Record<string, unknown>,
) => {
	switch (key) {
		case "deckFolders":
			return (item.updatedAt as string | null | undefined) ??
				(item.createdAt as string | null | undefined);
		case "decks":
			return (item.updatedAt as string | null | undefined) ??
				(item.createdAt as string | null | undefined);
		case "deckLinks":
			return (item.updatedAt as string | null | undefined) ??
				(item.createdAt as string | null | undefined);
		case "appSettings":
			return item.updatedAt as string | null | undefined;
		case "permanentDeletes":
			return item.deletedAt as string | null | undefined;
		case "knowledge":
			return (item.lastReview as string | null | undefined) ??
				(item.updatedAt as string | null | undefined) ??
				(item.createdAt as string | null | undefined);
		case "cards":
			return (item.updatedAt as string | null | undefined) ??
				(item.createdAt as string | null | undefined);
		case "knowledgeLinks":
			return (item.updatedAt as string | null | undefined) ??
				(item.createdAt as string | null | undefined);
		case "cardLinks":
			return (item.updatedAt as string | null | undefined) ??
				(item.createdAt as string | null | undefined);
		case "reviewLogs":
			return (item.updatedAt as string | null | undefined) ??
				(item.createdAt as string | null | undefined) ??
				(item.review as string | null | undefined);
		case "reviewUndos":
			return (item.updatedAt as string | null | undefined) ??
				(item.createdAt as string | null | undefined) ??
				(item.lastReview as string | null | undefined);
	}
};

const buildPushedItemVersionMap = (payload: SyncPullPayload) => {
	const versionMap = {
		deckFolders: new Map<string, string | null>(),
		decks: new Map<string, string | null>(),
		deckLinks: new Map<string, string | null>(),
		appSettings: new Map<string, string | null>(),
		permanentDeletes: new Map<string, string | null>(),
		knowledge: new Map<string, string | null>(),
		cards: new Map<string, string | null>(),
		knowledgeLinks: new Map<string, string | null>(),
		cardLinks: new Map<string, string | null>(),
		reviewLogs: new Map<string, string | null>(),
		reviewUndos: new Map<string, string | null>(),
	} satisfies Record<SyncTableKey, Map<string, string | null>>;

	for (const key of syncTableKeys) {
		for (const item of payload[key]) {
			versionMap[key].set(
				getSyncItemId(key, item as Record<string, unknown>),
				getSyncItemUpdatedAt(key, item as Record<string, unknown>) ?? null,
			);
		}
	}

	return versionMap;
};

export const stripEchoedPullItems = (
	pulled: SyncPullPayload,
	pushed: SyncPullPayload,
): SyncPullPayload => {
	const pushedVersionMap = buildPushedItemVersionMap(pushed);
	const filtered = emptySyncPayload();

	for (const key of syncTableKeys) {
		const nextItems = pulled[key].filter((item) => {
			const itemId = getSyncItemId(key, item as Record<string, unknown>);
			const pushedVersion = pushedVersionMap[key].get(itemId);

			if (pushedVersion === undefined) {
				return true;
			}

			return (
				getSyncItemUpdatedAt(key, item as Record<string, unknown>) ?? null
			) !== pushedVersion;
		});
		(filtered as Record<SyncTableKey, unknown[]>)[key] = nextItems as unknown[];
	}

	return filtered;
};

const chunkSyncTableItems = (
	items: SyncPullPayload[SyncTableKey],
	size: number,
) => {
	const chunks: SyncPullPayload[SyncTableKey][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
};

const syncTableKeys: SyncTableKey[] = [
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
];

const getPushBatchCount = (payload: SyncPullPayload) =>
	syncTableKeys.reduce(
		(total, key) =>
			total +
			(payload[key].length > 0
				? Math.ceil(payload[key].length / PUSH_BATCH_SIZE)
				: 0),
		0,
	);

const getPullPageCount = (totalCounts: Record<SyncTableKey, number>) =>
	Math.max(
		1,
		...syncTableKeys.map((key) =>
			Math.ceil(totalCounts[key] / PULL_LIMIT_PER_TABLE),
		),
	);

const addPullPage = (
	target: SyncPullPayload,
	page: SyncPullPayload,
) => {
	target.deckFolders.push(...page.deckFolders);
	target.decks.push(...page.decks);
	target.deckLinks.push(...page.deckLinks);
	target.appSettings.push(...page.appSettings);
	target.permanentDeletes.push(...page.permanentDeletes);
	target.knowledge.push(...page.knowledge);
	target.cards.push(...page.cards);
	target.knowledgeLinks.push(...page.knowledgeLinks);
	target.cardLinks.push(...page.cardLinks);
	target.reviewLogs.push(...page.reviewLogs);
	target.reviewUndos.push(...page.reviewUndos);
};

const buildPushBatchBody = ({
	key,
	batch,
	deviceId,
	syncMode,
	conflictStrategy,
	exportedAt,
}: {
	key: SyncTableKey;
	batch: SyncPullPayload[SyncTableKey];
	deviceId: string;
	syncMode: UserSyncSnapshot["syncMode"];
	conflictStrategy: SyncConflictStrategy;
	exportedAt: string;
}) => {
	const payload = {
		deviceId,
		syncMode,
		conflictStrategy,
		exportedAt,
		...emptySyncPayload(),
	};

	switch (key) {
		case "deckFolders":
			return { ...payload, deckFolders: batch as SyncPullPayload["deckFolders"] };
		case "decks":
			return { ...payload, decks: batch as SyncPullPayload["decks"] };
		case "deckLinks":
			return { ...payload, deckLinks: batch as SyncPullPayload["deckLinks"] };
		case "appSettings":
			return { ...payload, appSettings: batch as SyncPullPayload["appSettings"] };
		case "permanentDeletes":
			return {
				...payload,
				permanentDeletes: batch as SyncPullPayload["permanentDeletes"],
			};
		case "knowledge":
			return { ...payload, knowledge: batch as SyncPullPayload["knowledge"] };
		case "cards":
			return { ...payload, cards: batch as SyncPullPayload["cards"] };
		case "knowledgeLinks":
			return {
				...payload,
				knowledgeLinks: batch as SyncPullPayload["knowledgeLinks"],
			};
		case "cardLinks":
			return { ...payload, cardLinks: batch as SyncPullPayload["cardLinks"] };
		case "reviewLogs":
			return { ...payload, reviewLogs: batch as SyncPullPayload["reviewLogs"] };
		case "reviewUndos":
			return { ...payload, reviewUndos: batch as SyncPullPayload["reviewUndos"] };
	}
};

const pullAllSyncPages = async ({
	token,
	deviceId,
	since,
	progressLabel,
	onProgress,
}: {
	token: string;
	deviceId: string;
	since: string | null;
	progressLabel?: string;
	onProgress?: (progress: ManualSyncProgress) => void;
}): Promise<PullSyncDataResponse> => {
	const aggregate = emptySyncPayload();
	const offsets: SyncPullOffsets = { ...EMPTY_PULL_OFFSETS };
	let until: string | null = null;
	let serverTime: string | null = null;
	let hasMore = false;
	let totalPages = 1;
	let completedPages = 0;

	do {
		const page: PullSyncDataResponse = await postSyncJson<PullSyncDataResponse>(
			"/pull",
			token,
			{
				deviceId,
				since,
				until,
				offsets,
				limitPerTable: PULL_LIMIT_PER_TABLE,
			},
		);

		if (!until) {
			until = page.cursor;
			if (page.totalCounts) {
				totalPages = getPullPageCount(page.totalCounts);
			}
		}
		serverTime = page.serverTime;
		hasMore = page.hasMore;
		addPullPage(aggregate, page);
		completedPages += 1;
		if (progressLabel) {
			onProgress?.({
				label: progressLabel,
				completed: completedPages,
				total: totalPages,
			});
		}

		for (const key of syncTableKeys) {
			offsets[key] += page[key].length;
		}
	} while (hasMore);

	return {
		ok: true,
		serverTime: serverTime ?? new Date().toISOString(),
		cursor: until ?? new Date().toISOString(),
		hasMore: false,
		totalCounts: null,
		...aggregate,
	};
};

const pushChangedSyncData = async ({
	token,
	deviceId,
	syncMode,
	conflictStrategy,
	exportedAt,
	payload,
	onProgress,
}: {
	token: string;
	deviceId: string;
	syncMode: UserSyncSnapshot["syncMode"];
	conflictStrategy: SyncConflictStrategy;
	exportedAt: string;
	payload: SyncPullPayload;
	onProgress?: (progress: ManualSyncProgress) => void;
}) => {
	let lastResponse: PushSyncDataResponse | null = null;
	const totalBatches = getPushBatchCount(payload);
	let completedBatches = 0;

	if (totalBatches > 0) {
		onProgress?.({
			label: "Upload",
			completed: 0,
			total: totalBatches,
		});
	}

	for (const key of syncTableKeys) {
		const items = payload[key];

		if (items.length === 0) {
			continue;
		}

		for (const batch of chunkSyncTableItems(items, PUSH_BATCH_SIZE)) {
			lastResponse = await postSyncJson<PushSyncDataResponse>(
				"/push",
				token,
				buildPushBatchBody({
					key,
					batch,
					deviceId,
					syncMode,
					conflictStrategy,
					exportedAt,
				}),
			);
			completedBatches += 1;
			onProgress?.({
				label: "Upload",
				completed: completedBatches,
				total: totalBatches,
			});
		}
	}

	return lastResponse;
};

const buildChangedIdSet = <T extends { id: string }>(
	items: T[],
	since: string | null,
	getUpdatedAt: (item: T) => string | null | undefined,
) =>
	new Set(
		items
			.filter((item) => changedSince(getUpdatedAt(item), since))
			.map((item) => item.id),
	);

const countConflicts = <T extends { id: string }>(
	items: T[],
	localChangedIds: Set<string>,
) => items.filter((item) => localChangedIds.has(item.id)).length;

const summarizeChangedLocalItems = (
	localSnapshot: UserSyncSnapshot,
	since: string | null,
): ManualSyncChangeSummary => {
	const deckFolders = buildChangedIdSet(
		localSnapshot.deckFolders,
		since,
		deckFolderUpdatedAt,
	).size;
	const decks = buildChangedIdSet(localSnapshot.decks, since, deckUpdatedAt).size;
	const deckLinks = buildChangedIdSet(
		localSnapshot.deckLinks,
		since,
		deckLinkUpdatedAt,
	).size;
	const appSettings = buildChangedIdSet(
		localSnapshot.appSettings.map((item) => ({ ...item, id: item.key })),
		since,
		(item) => item.updatedAt,
	).size;
	const permanentDeletes = buildChangedIdSet(
		localSnapshot.permanentDeletes,
		since,
		permanentDeleteUpdatedAt,
	).size;
	const knowledge = buildChangedIdSet(
		localSnapshot.knowledge,
		since,
		knowledgeUpdatedAt,
	).size;
	const cards = buildChangedIdSet(localSnapshot.cards, since, cardUpdatedAt).size;
	const knowledgeLinks = buildChangedIdSet(
		localSnapshot.knowledgeLinks,
		since,
		knowledgeLinkUpdatedAt,
	).size;
	const cardLinks = buildChangedIdSet(
		localSnapshot.cardLinks,
		since,
		cardLinkUpdatedAt,
	).size;
	const reviewLogs = buildChangedIdSet(
		localSnapshot.reviewLogs,
		since,
		reviewLogUpdatedAt,
	).size;
	const reviewUndos = buildChangedIdSet(
		localSnapshot.reviewUndos,
		since,
		reviewUndoUpdatedAt,
	).size;

	return {
		total:
			deckFolders +
			decks +
			deckLinks +
			appSettings +
			permanentDeletes +
			knowledge +
			cards +
			knowledgeLinks +
			cardLinks +
			reviewLogs +
			reviewUndos,
		deckFolders,
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

const summarizeRemoteChanges = (
	remoteSnapshot: SyncPullPayload,
): ManualSyncChangeSummary => {
	const deckFolders = remoteSnapshot.deckFolders.length;
	const decks = remoteSnapshot.decks.length;
	const deckLinks = remoteSnapshot.deckLinks.length;
	const appSettings = remoteSnapshot.appSettings.length;
	const permanentDeletes = remoteSnapshot.permanentDeletes.length;
	const knowledge = remoteSnapshot.knowledge.length;
	const cards = remoteSnapshot.cards.length;
	const knowledgeLinks = remoteSnapshot.knowledgeLinks.length;
	const cardLinks = remoteSnapshot.cardLinks.length;
	const reviewLogs = remoteSnapshot.reviewLogs.length;
	const reviewUndos = remoteSnapshot.reviewUndos.length;

	return {
		total:
			deckFolders +
			decks +
			deckLinks +
			appSettings +
			permanentDeletes +
			knowledge +
			cards +
			knowledgeLinks +
			cardLinks +
			reviewLogs +
			reviewUndos,
		deckFolders,
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

const getLastCompletedSyncAt = ({
	lastPulledAt,
	lastPushedAt,
}: {
	lastPulledAt: string | null;
	lastPushedAt: string | null;
}) => {
	if (!lastPulledAt) {
		return lastPushedAt;
	}

	if (!lastPushedAt) {
		return lastPulledAt;
	}

	const pulledTime = toEpoch(lastPulledAt);
	const pushedTime = toEpoch(lastPushedAt);

	if (pulledTime === null) {
		return lastPushedAt;
	}

	if (pushedTime === null) {
		return lastPulledAt;
	}

	return pulledTime >= pushedTime ? lastPulledAt : lastPushedAt;
};

const getConflictSummary = (
	localSnapshot: UserSyncSnapshot,
	remoteSnapshot: SyncPullPayload,
	since: string | null,
): ManualSyncConflictSummary => {
	const localDeckFolderIds = buildChangedIdSet(
		localSnapshot.deckFolders,
		since,
		deckFolderUpdatedAt,
	);
	const localDeckIds = buildChangedIdSet(localSnapshot.decks, since, deckUpdatedAt);
	const localDeckLinkIds = buildChangedIdSet(
		localSnapshot.deckLinks,
		since,
		deckLinkUpdatedAt,
	);
	const localAppSettingIds = buildChangedIdSet(
		localSnapshot.appSettings.map((item) => ({ ...item, id: item.key })),
		since,
		(item) => item.updatedAt,
	);
	const localPermanentDeleteIds = buildChangedIdSet(
		localSnapshot.permanentDeletes,
		since,
		permanentDeleteUpdatedAt,
	);
	const localKnowledgeIds = buildChangedIdSet(
		localSnapshot.knowledge,
		since,
		knowledgeUpdatedAt,
	);
	const localCardIds = buildChangedIdSet(localSnapshot.cards, since, cardUpdatedAt);
	const localKnowledgeLinkIds = buildChangedIdSet(
		localSnapshot.knowledgeLinks,
		since,
		knowledgeLinkUpdatedAt,
	);
	const localCardLinkIds = buildChangedIdSet(
		localSnapshot.cardLinks,
		since,
		cardLinkUpdatedAt,
	);
	const localReviewLogIds = buildChangedIdSet(
		localSnapshot.reviewLogs,
		since,
		reviewLogUpdatedAt,
	);
	const localReviewUndoIds = buildChangedIdSet(
		localSnapshot.reviewUndos,
		since,
		reviewUndoUpdatedAt,
	);

	const deckFolders = countConflicts(remoteSnapshot.deckFolders, localDeckFolderIds);
	const decks = countConflicts(remoteSnapshot.decks, localDeckIds);
	const deckLinks = countConflicts(remoteSnapshot.deckLinks, localDeckLinkIds);
	const appSettings = countConflicts(
		remoteSnapshot.appSettings.map((item) => ({ ...item, id: item.key })),
		localAppSettingIds,
	);
	const permanentDeletes = countConflicts(
		remoteSnapshot.permanentDeletes,
		localPermanentDeleteIds,
	);
	const knowledge = countConflicts(remoteSnapshot.knowledge, localKnowledgeIds);
	const cards = countConflicts(remoteSnapshot.cards, localCardIds);
	const knowledgeLinks = countConflicts(
		remoteSnapshot.knowledgeLinks,
		localKnowledgeLinkIds,
	);
	const cardLinks = countConflicts(remoteSnapshot.cardLinks, localCardLinkIds);
	const reviewLogs = countConflicts(remoteSnapshot.reviewLogs, localReviewLogIds);
	const reviewUndos = countConflicts(remoteSnapshot.reviewUndos, localReviewUndoIds);

	return {
		total:
			deckFolders +
			decks +
			deckLinks +
			appSettings +
			permanentDeletes +
			knowledge +
			cards +
			knowledgeLinks +
			cardLinks +
			reviewLogs +
			reviewUndos,
		deckFolders,
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

export const runManualSync = async ({
	db,
	getToken,
	conflictStrategy,
	source = "manual",
	onProgress,
}: {
	db: DrizzleInstance;
	getToken: () => Promise<string | null>;
	conflictStrategy?: SyncConflictStrategy;
	source?: "manual" | "automatic";
	onProgress?: (progress: ManualSyncProgress) => void;
}): Promise<ManualSyncResult | ManualSyncConflictResult> => {
	await appendSyncDebugEvent(db, "sync.run.start", {
		source,
		conflictStrategy: conflictStrategy ?? null,
	});
	const token = await getToken();

	if (!token) {
		await appendSyncDebugEvent(db, "sync.run.no_token", {
			source,
		});
		throw new Error("You need to sign in before using cloud sync.");
	}

	const syncSettings = await getSyncSettingsSnapshot(db);
	const snapshot = await exportUserSyncSnapshot(db, undefined, {
		onProgress,
	});
	const lastCompletedSyncAt = getLastCompletedSyncAt(syncSettings);
	const changedSnapshot = buildChangedSnapshot(
		snapshot,
		syncSettings.lastPushedAt,
	);
	const localChanges = summarizeChangedLocalItems(
		snapshot,
		lastCompletedSyncAt,
	);

	const previewPull = await pullAllSyncPages({
		token,
		deviceId: snapshot.deviceId,
		since: syncSettings.lastPulledAt,
		progressLabel: "Check",
		onProgress,
	});
	await appendSyncDebugEvent(db, "sync.run.preview_pull", {
		source,
		since: syncSettings.lastPulledAt,
		remoteTotal: previewPull.deckFolders.length +
			previewPull.decks.length +
			previewPull.deckLinks.length +
			previewPull.appSettings.length +
			previewPull.permanentDeletes.length +
			previewPull.knowledge.length +
			previewPull.cards.length +
			previewPull.knowledgeLinks.length +
			previewPull.cardLinks.length +
			previewPull.reviewLogs.length +
			previewPull.reviewUndos.length,
	});
	const conflictSummary = getConflictSummary(
		snapshot,
		previewPull,
		syncSettings.lastPulledAt,
	);

	if (conflictSummary.total > 0 && !conflictStrategy) {
		await appendSyncDebugEvent(db, "sync.run.conflict", {
			source,
			total: conflictSummary.total,
		});
		return {
			requiresConflictResolution: true,
			conflicts: conflictSummary,
		};
	}

	const resolvedConflictStrategy = conflictStrategy ?? "remote";

	await postSyncJson<RegisterSyncDeviceResponse>("/register", token, {
		deviceId: snapshot.deviceId,
		platform: "expo",
		syncMode: snapshot.syncMode,
		conflictStrategy: resolvedConflictStrategy,
	});
	onProgress?.({
		label: "Register",
		completed: 1,
		total: 1,
	});

	const pushResult = await pushChangedSyncData({
		token,
		deviceId: snapshot.deviceId,
		syncMode: snapshot.syncMode,
		conflictStrategy: resolvedConflictStrategy,
		exportedAt: snapshot.exportedAt,
		payload: changedSnapshot,
		onProgress,
	});
	if (pushResult) {
		await appendSyncDebugEvent(db, "sync.run.push_ok", {
			source,
			serverTime: pushResult.serverTime,
			pushWatermark: snapshot.exportedAt,
			localTotal: localChanges.total,
		});
	} else {
		await appendSyncDebugEvent(db, "sync.run.push_skipped", {
			source,
			localTotal: localChanges.total,
		});
	}

	const pullResult = await pullAllSyncPages({
		token,
		deviceId: snapshot.deviceId,
		since: syncSettings.lastPulledAt,
		progressLabel: "Download",
		onProgress,
	});
	const dedupedPullResult = pushResult
		? stripEchoedPullItems(pullResult, changedSnapshot)
		: pullResult;
	const remoteChanges = summarizeRemoteChanges(dedupedPullResult);
	await appendSyncDebugEvent(db, "sync.run.pull_ok", {
		source,
		cursor: pullResult.cursor,
		remoteTotal: remoteChanges.total,
		rawRemoteTotal: summarizeRemoteChanges(pullResult).total,
	});

	await importPulledSyncData(db, dedupedPullResult, {
		onProgress,
	});
	clearFsrsEngineCache();
	clearReviewEntryDetailCache();
	await appendSyncDebugEvent(db, "sync.run.import_ok", {
		source,
		remoteTotal: remoteChanges.total,
	});

	if (pushResult) {
		await markSyncPush(db, snapshot.exportedAt);
	}
	await markSyncPull(db, pullResult.cursor);
	await appendSyncDebugEvent(db, "sync.run.complete", {
		source,
		localTotal: localChanges.total,
		remoteTotal: remoteChanges.total,
	});

	return {
		serverTime: pullResult.serverTime,
		localChanges,
		remoteChanges,
	};
};
