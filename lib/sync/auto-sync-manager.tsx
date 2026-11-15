import * as React from "react";
import { useAuth } from "@clerk/expo";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { useAppLanguage } from "@/lib/store/appLanguageStore";
import { refreshDecksStore } from "@/lib/store/decksStore";
import { runManualSync } from "@/lib/sync/client";
import { appendSyncDebugEvent } from "@/lib/sync/debug";
import { hasUnsyncedLocalChanges } from "@/lib/sync/logic";
import { useSyncSettings } from "@/lib/sync/settings";

export function AutoSyncManager() {
	const db = useDrizzle();
	const { isSignedIn, getToken } = useAuth();
	const { activeLanguageId } = useAppLanguage();
	const {
		isReady,
		mode,
		lastLocalChangeAt,
		lastPulledAt,
		lastPushedAt,
		refresh,
	} = useSyncSettings();
	const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	const inFlightRef = React.useRef(false);
	const lastCompletedChangeRef = React.useRef<string | null>(null);
	const runAutomaticSyncRef = React.useRef<(() => Promise<void>) | null>(null);
	const latestRefs = React.useRef({
		db,
		getToken,
		isSignedIn,
		lastLocalChangeAt,
		refresh,
		activeLanguageId,
	});

	React.useEffect(() => {
		latestRefs.current = {
			db,
			getToken,
			isSignedIn,
			lastLocalChangeAt,
			refresh,
			activeLanguageId,
		};
	}, [activeLanguageId, db, getToken, isSignedIn, lastLocalChangeAt, refresh]);

	const clearScheduledSync = React.useCallback(() => {
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	}, []);

	const scheduleAutomaticSync = React.useCallback(
		(delayMs: number) => {
			clearScheduledSync();
			void appendSyncDebugEvent(db, "autosync.scheduled", {
				delayMs,
			});
			timeoutRef.current = setTimeout(() => {
				void runAutomaticSyncRef.current?.();
			}, delayMs);
		},
		[clearScheduledSync, db],
	);

	const runAutomaticSync = React.useCallback(async () => {
		const {
			db: currentDb,
			getToken: currentGetToken,
			isSignedIn: currentIsSignedIn,
			lastLocalChangeAt: currentLastLocalChangeAt,
			refresh: currentRefresh,
			activeLanguageId: currentActiveLanguageId,
		} = latestRefs.current;

		if (inFlightRef.current || !currentIsSignedIn || !currentLastLocalChangeAt) {
			if (currentLastLocalChangeAt) {
				void appendSyncDebugEvent(currentDb, "autosync.skipped", {
					inFlight: inFlightRef.current,
					isSignedIn: currentIsSignedIn,
				});
			}
			return;
		}

		inFlightRef.current = true;
		await appendSyncDebugEvent(currentDb, "autosync.start", {
			lastLocalChangeAt: currentLastLocalChangeAt,
		});

		try {
			let result = await runManualSync({
				db: currentDb,
				getToken: () => currentGetToken(),
				source: "automatic",
			});

			if ("requiresConflictResolution" in result) {
				// Automatic sync should not block on an interactive prompt. When this
				// device has just produced local changes, prefer pushing that state.
				await appendSyncDebugEvent(currentDb, "autosync.retry_local", {
					total: result.conflicts.total,
				});
				result = await runManualSync({
					db: currentDb,
					getToken: () => currentGetToken(),
					conflictStrategy: "local",
					source: "automatic",
				});
			}

			if ("requiresConflictResolution" in result) {
				await appendSyncDebugEvent(currentDb, "autosync.unresolved_conflict", {
					total: result.conflicts.total,
				});
				scheduleAutomaticSync(5000);
				return;
			}

			lastCompletedChangeRef.current = currentLastLocalChangeAt;
			await refreshDecksStore(currentDb, currentActiveLanguageId);
			await currentRefresh();
			await appendSyncDebugEvent(currentDb, "autosync.complete", {
				lastLocalChangeAt: currentLastLocalChangeAt,
				serverTime: result.serverTime,
			});
		} catch (error) {
			console.error("Automatic sync failed.", error);
			await appendSyncDebugEvent(currentDb, "autosync.error", {
				message: error instanceof Error ? error.message : "unknown",
			});
			scheduleAutomaticSync(5000);
		} finally {
			inFlightRef.current = false;
		}
	}, [scheduleAutomaticSync]);

	React.useEffect(() => {
		runAutomaticSyncRef.current = runAutomaticSync;
	}, [runAutomaticSync]);

	React.useEffect(() => {
		if (!isReady || mode !== "automatic" || !isSignedIn) {
			void appendSyncDebugEvent(db, "autosync.effect_blocked", {
				reason: !isReady
					? "not_ready"
					: mode !== "automatic"
						? "mode_not_automatic"
						: "not_signed_in",
				isReady,
				mode,
				isSignedIn,
			});
			clearScheduledSync();
			return;
		}

		if (
			!hasUnsyncedLocalChanges({
				lastLocalChangeAt,
				lastPushedAt,
			})
		) {
			void appendSyncDebugEvent(db, "autosync.effect_blocked", {
				reason: "no_unsynced_local_changes",
				lastLocalChangeAt,
				lastPushedAt,
				lastPulledAt,
			});
			clearScheduledSync();
			return;
		}

		if (lastLocalChangeAt && lastCompletedChangeRef.current === lastLocalChangeAt) {
			void appendSyncDebugEvent(db, "autosync.effect_blocked", {
				reason: "already_completed_for_change",
				lastLocalChangeAt,
			});
			return;
		}

		scheduleAutomaticSync(1500);

		return clearScheduledSync;
	}, [
		clearScheduledSync,
		db,
		isSignedIn,
		isReady,
		lastLocalChangeAt,
		lastPulledAt,
		lastPushedAt,
		mode,
		scheduleAutomaticSync,
	]);

	React.useEffect(
		() => () => {
			clearScheduledSync();
		},
		[clearScheduledSync],
	);

	return null;
}
