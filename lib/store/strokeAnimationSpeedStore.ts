import * as React from "react";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { eq } from "drizzle-orm";
import { useDrizzle, type DrizzleInstance } from "@/lib/database/DrizzleContext";
import { appSettings } from "@/lib/database/schema";
import { markLocalChange } from "@/lib/sync/settings";

export type StrokeAnimationSpeed = "normal" | "fast" | "fast_plus";

export const STROKE_ANIMATION_SPEED_KEY = "stroke_animation_speed";

export const STROKE_ANIMATION_SPEED_MULTIPLIERS: Record<
	StrokeAnimationSpeed,
	number
> = {
	normal: 1,
	fast: 1.5,
	fast_plus: 2,
};

interface StrokeAnimationSpeedState {
	isReady: boolean;
	speed: StrokeAnimationSpeed;
}

const strokeAnimationSpeedDefaults: StrokeAnimationSpeedState = {
	isReady: false,
	speed: "normal",
};

export const strokeAnimationSpeed$ = observable<StrokeAnimationSpeedState>(
	strokeAnimationSpeedDefaults,
);

let inflightLoad: Promise<StrokeAnimationSpeed> | null = null;

const normalizeStrokeAnimationSpeed = (
	value: string | null | undefined,
): StrokeAnimationSpeed => {
	if (value === "fast" || value === "fast_plus") {
		return value;
	}

	return "normal";
};

const persistStrokeAnimationSpeed = async (
	db: DrizzleInstance,
	speed: StrokeAnimationSpeed,
) => {
	await db
		.insert(appSettings)
		.values({
			key: STROKE_ANIMATION_SPEED_KEY,
			value: speed,
		})
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value: speed },
		});
};

export const isStrokeAnimationSpeedSettingKey = (key: string) =>
	key === STROKE_ANIMATION_SPEED_KEY;

export const getStrokeAnimationSpeed = async (
	db: DrizzleInstance,
): Promise<StrokeAnimationSpeed> => {
	const row = await db.query.appSettings.findFirst({
		where: eq(appSettings.key, STROKE_ANIMATION_SPEED_KEY),
	});
	const speed = normalizeStrokeAnimationSpeed(row?.value);

	if (row?.value !== speed) {
		await persistStrokeAnimationSpeed(db, speed);
	}

	return speed;
};

export const refreshStrokeAnimationSpeed = async (db: DrizzleInstance) => {
	if (!inflightLoad) {
		inflightLoad = (async () => {
			try {
				const speed = await getStrokeAnimationSpeed(db);
				strokeAnimationSpeed$.set({
					isReady: true,
					speed,
				});
				return speed;
			} finally {
				inflightLoad = null;
			}
		})();
	}

	return inflightLoad;
};

export const setStrokeAnimationSpeed = async (
	db: DrizzleInstance,
	speed: StrokeAnimationSpeed,
) => {
	await persistStrokeAnimationSpeed(db, speed);
	await markLocalChange(db);
	strokeAnimationSpeed$.speed.set(speed);
	strokeAnimationSpeed$.isReady.set(true);
};

export const useStrokeAnimationSpeed = () => {
	const db = useDrizzle();
	const snapshot = useSelector(() => ({
		isReady: strokeAnimationSpeed$.isReady.get(),
		speed: strokeAnimationSpeed$.speed.get(),
	}));

	const refresh = React.useCallback(
		async () => refreshStrokeAnimationSpeed(db),
		[db],
	);

	React.useEffect(() => {
		if (!snapshot.isReady) {
			void refresh();
		}
	}, [refresh, snapshot.isReady]);

	const updateSpeed = React.useCallback(
		async (speed: StrokeAnimationSpeed) => {
			const previousSpeed = strokeAnimationSpeed$.speed.peek();
			const isReady = strokeAnimationSpeed$.isReady.peek();

			if (isReady && previousSpeed === speed) {
				return;
			}

			strokeAnimationSpeed$.speed.set(speed);
			strokeAnimationSpeed$.isReady.set(true);

			try {
				await setStrokeAnimationSpeed(db, speed);
			} catch (error) {
				console.error("Failed to persist stroke animation speed.", error);
				strokeAnimationSpeed$.speed.set(previousSpeed);
				if (!isReady) {
					await refresh();
				}
			}
		},
		[db, refresh],
	);

	return {
		...snapshot,
		multiplier: STROKE_ANIMATION_SPEED_MULTIPLIERS[snapshot.speed],
		refresh,
		setSpeed: updateSpeed,
	};
};
