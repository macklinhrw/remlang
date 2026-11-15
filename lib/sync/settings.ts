import * as React from "react";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { inArray } from "drizzle-orm";
import { useDrizzle, type DrizzleInstance } from "@/lib/database/DrizzleContext";
import { appSettings } from "@/lib/database/schema";
import { generateId } from "@/lib/id";
import { appendSyncDebugEvent } from "@/lib/sync/debug";
import { computeNextLocalChangeTimestamp } from "@/lib/sync/logic";

export type SyncMode = "manual" | "automatic";

export const SYNC_MODE_KEY = "sync_mode";
export const SYNC_DEVICE_ID_KEY = "sync_device_id";
export const SYNC_LAST_PUSHED_AT_KEY = "sync_last_pushed_at";
export const SYNC_LAST_PULLED_AT_KEY = "sync_last_pulled_at";
export const SYNC_LAST_LOCAL_CHANGE_AT_KEY = "sync_last_local_change_at";

const SYNC_SETTING_KEYS = [
	SYNC_MODE_KEY,
	SYNC_DEVICE_ID_KEY,
	SYNC_LAST_PUSHED_AT_KEY,
	SYNC_LAST_PULLED_AT_KEY,
	SYNC_LAST_LOCAL_CHANGE_AT_KEY,
] as const;

export interface SyncSettingsSnapshot {
	mode: SyncMode;
	deviceId: string;
	lastPushedAt: string | null;
	lastPulledAt: string | null;
	lastLocalChangeAt: string | null;
}

interface SyncSettingsState extends SyncSettingsSnapshot {
	isReady: boolean;
}

const normalizeSyncMode = (value: string | null | undefined): SyncMode =>
	value === "automatic" ? "automatic" : "manual";

const syncSettingsDefaults: SyncSettingsState = {
	isReady: false,
	mode: "manual",
	deviceId: "",
	lastPushedAt: null,
	lastPulledAt: null,
	lastLocalChangeAt: null,
};

export const syncSettings$ = observable<SyncSettingsState>(syncSettingsDefaults);

let inflightLoad: Promise<SyncSettingsSnapshot> | null = null;

const persistSetting = async (
	db: DrizzleInstance,
	key: string,
	value: string | null,
) => {
	await db
		.insert(appSettings)
		.values({
			key,
			value,
		})
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value },
		});
};

const applySyncSettingsSnapshot = (snapshot: SyncSettingsSnapshot) => {
	syncSettings$.set({
		isReady: true,
		...snapshot,
	});
	return snapshot;
};

export const getSyncSettingsSnapshot = async (
	db: DrizzleInstance,
): Promise<SyncSettingsSnapshot> => {
	const rows = await db.query.appSettings.findMany({
		where: inArray(appSettings.key, [...SYNC_SETTING_KEYS]),
	});
	const values = new Map(rows.map((row) => [row.key, row.value]));

	const mode = normalizeSyncMode(values.get(SYNC_MODE_KEY));
	const deviceId = values.get(SYNC_DEVICE_ID_KEY) ?? `dev_${generateId()}`;
	const lastPushedAt = values.get(SYNC_LAST_PUSHED_AT_KEY) ?? null;
	const lastPulledAt = values.get(SYNC_LAST_PULLED_AT_KEY) ?? null;
	const lastLocalChangeAt = values.get(SYNC_LAST_LOCAL_CHANGE_AT_KEY) ?? null;

	if (values.get(SYNC_MODE_KEY) !== mode) {
		await persistSetting(db, SYNC_MODE_KEY, mode);
	}
	if (values.get(SYNC_DEVICE_ID_KEY) !== deviceId) {
		await persistSetting(db, SYNC_DEVICE_ID_KEY, deviceId);
	}

	return {
		mode,
		deviceId,
		lastPushedAt,
		lastPulledAt,
		lastLocalChangeAt,
	};
};

export const refreshSyncSettings = async (db: DrizzleInstance) => {
	if (!inflightLoad) {
		inflightLoad = (async () => {
			try {
				const snapshot = await getSyncSettingsSnapshot(db);
				return applySyncSettingsSnapshot(snapshot);
			} finally {
				inflightLoad = null;
			}
		})();
	}

	return inflightLoad;
};

export const setSyncMode = async (db: DrizzleInstance, mode: SyncMode) => {
	await persistSetting(db, SYNC_MODE_KEY, mode);
	syncSettings$.mode.set(mode);
	syncSettings$.isReady.set(true);
};

export const markSyncPush = async (db: DrizzleInstance, timestamp: string) => {
	await persistSetting(db, SYNC_LAST_PUSHED_AT_KEY, timestamp);
	syncSettings$.lastPushedAt.set(timestamp);
	syncSettings$.isReady.set(true);
	await appendSyncDebugEvent(db, "sync.push_marked", {
		timestamp,
	});
};

export const markSyncPull = async (db: DrizzleInstance, timestamp: string) => {
	await persistSetting(db, SYNC_LAST_PULLED_AT_KEY, timestamp);
	syncSettings$.lastPulledAt.set(timestamp);
	syncSettings$.isReady.set(true);
	await appendSyncDebugEvent(db, "sync.pull_marked", {
		timestamp,
	});
};

export const markLocalChange = async (
	db: DrizzleInstance,
	timestamp?: string,
) => {
	const snapshot = await getSyncSettingsSnapshot(db);
	const nextTimestamp = computeNextLocalChangeTimestamp({
		candidateTimestamp: timestamp,
		lastLocalChangeAt: snapshot.lastLocalChangeAt,
		lastPushedAt: snapshot.lastPushedAt,
		lastPulledAt: snapshot.lastPulledAt,
	});

	await persistSetting(db, SYNC_LAST_LOCAL_CHANGE_AT_KEY, nextTimestamp);
	syncSettings$.lastLocalChangeAt.set(nextTimestamp);
	syncSettings$.isReady.set(true);
	await appendSyncDebugEvent(db, "sync.local_change_marked", {
		timestamp: nextTimestamp,
		lastPushedAt: snapshot.lastPushedAt,
		lastPulledAt: snapshot.lastPulledAt,
	});
	return nextTimestamp;
};

export const useSyncSettings = () => {
	const db = useDrizzle();
	const snapshot = useSelector(() => ({
		isReady: syncSettings$.isReady.get(),
		mode: syncSettings$.mode.get(),
		deviceId: syncSettings$.deviceId.get(),
		lastPushedAt: syncSettings$.lastPushedAt.get(),
		lastPulledAt: syncSettings$.lastPulledAt.get(),
		lastLocalChangeAt: syncSettings$.lastLocalChangeAt.get(),
	}));

	const refresh = React.useCallback(async () => refreshSyncSettings(db), [db]);

	React.useEffect(() => {
		if (!snapshot.isReady) {
			void refresh();
		}
	}, [refresh, snapshot.isReady]);

	const updateMode = React.useCallback(
		async (mode: SyncMode) => {
			const previousMode = syncSettings$.mode.peek();
			const isReady = syncSettings$.isReady.peek();

			if (isReady && previousMode === mode) {
				return;
			}

			syncSettings$.mode.set(mode);
			syncSettings$.isReady.set(true);

			try {
				await setSyncMode(db, mode);
			} catch (error) {
				console.error("Failed to persist sync mode.", error);
				syncSettings$.mode.set(previousMode);
				if (!isReady) {
					await refresh();
				}
			}
		},
		[db, refresh],
	);

	return {
		...snapshot,
		refresh,
		setMode: updateMode,
	};
};
