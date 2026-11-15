export const toEpoch = (value: string | null | undefined) => {
	if (!value) return null;
	const parsed = new Date(value).getTime();
	return Number.isNaN(parsed) ? null : parsed;
};

export const hasUnsyncedLocalChanges = ({
	lastLocalChangeAt,
	lastPushedAt,
}: {
	lastLocalChangeAt: string | null;
	lastPushedAt: string | null;
}) => {
	if (!lastLocalChangeAt) {
		return false;
	}

	const localChangeTime = toEpoch(lastLocalChangeAt);
	const lastPushTime = toEpoch(lastPushedAt);

	if (localChangeTime === null) {
		return false;
	}

	if (lastPushTime === null) {
		return true;
	}

	return localChangeTime > lastPushTime;
};

export const computeNextLocalChangeTimestamp = ({
	candidateTimestamp,
	lastLocalChangeAt,
	lastPushedAt,
	lastPulledAt,
}: {
	candidateTimestamp?: string | null;
	lastLocalChangeAt: string | null;
	lastPushedAt: string | null;
	lastPulledAt: string | null;
}) => {
	const candidateTime =
		toEpoch(candidateTimestamp ?? new Date().toISOString()) ?? Date.now();
	const floorTime = Math.max(
		toEpoch(lastLocalChangeAt) ?? Number.NEGATIVE_INFINITY,
		toEpoch(lastPushedAt) ?? Number.NEGATIVE_INFINITY,
		toEpoch(lastPulledAt) ?? Number.NEGATIVE_INFINITY,
	);

	return new Date(
		Number.isFinite(floorTime) && candidateTime <= floorTime
			? floorTime + 1
			: candidateTime,
	).toISOString();
};
