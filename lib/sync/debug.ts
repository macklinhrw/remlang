import type { DrizzleInstance } from "@/lib/database/DrizzleContext";

export interface SyncDebugEvent {
	at: string;
	event: string;
	details?: Record<string, string | number | boolean | null>;
}

const SYNC_DEBUG_LOGGING_ENABLED =
	typeof __DEV__ === "boolean" ? __DEV__ : false;

const formatDetails = (
	details?: Record<string, string | number | boolean | null | undefined>,
) =>
	details
		? Object.fromEntries(
				Object.entries(details).map(([key, value]) => [key, value ?? null]),
			)
		: undefined;

export const appendSyncDebugEvent = async (
	_db: DrizzleInstance,
	event: string,
	details?: Record<string, string | number | boolean | null | undefined>,
) => {
	const nextEvent: SyncDebugEvent = {
		at: new Date().toISOString(),
		event,
		details: formatDetails(details),
	};

	if (!SYNC_DEBUG_LOGGING_ENABLED) {
		return nextEvent;
	}

	if (nextEvent.details) {
		console.log("[sync]", nextEvent.event, nextEvent.at, nextEvent.details);
	} else {
		console.log("[sync]", nextEvent.event, nextEvent.at);
	}

	return nextEvent;
};
