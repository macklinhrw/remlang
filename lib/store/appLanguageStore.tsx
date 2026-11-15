import * as React from "react";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { eq } from "drizzle-orm";
import { Text } from "@/components/ui/text";
import { useDrizzle, type DrizzleInstance } from "@/lib/database/DrizzleContext";
import { appSettings, languages } from "@/lib/database/schema";

export const DEFAULT_LANGUAGE_ID = "lang_zh";
const ACTIVE_LANGUAGE_KEY = "active_language_id";
const REQUIRED_APP_LANGUAGES: readonly AppLanguageOption[] = [
	{
		id: "lang_zh",
		code: "zh",
		name: "Chinese",
	},
	{
		id: "lang_ja",
		code: "ja",
		name: "Japanese",
	},
];

export interface AppLanguageOption {
	id: string;
	code: string;
	name: string;
}

interface AppLanguageState {
	isReady: boolean;
	activeLanguageId: string;
	availableLanguages: AppLanguageOption[];
}

const appLanguageDefaults: AppLanguageState = {
	isReady: false,
	activeLanguageId: DEFAULT_LANGUAGE_ID,
	availableLanguages: [],
};

export const appLanguage$ = observable<AppLanguageState>(appLanguageDefaults);

let inflightLoad: Promise<void> | null = null;

const ensureRequiredAppLanguages = async (db: DrizzleInstance) => {
	for (const language of REQUIRED_APP_LANGUAGES) {
		await db
			.insert(languages)
			.values({
				id: language.id,
				code: language.code,
				name: language.name,
				defaultGlossLanguage: "eng",
				isEnabled: true,
			})
			.onConflictDoUpdate({
				target: languages.id,
				set: {
					code: language.code,
					name: language.name,
					defaultGlossLanguage: "eng",
					isEnabled: true,
				},
			});
	}
};

const getEnabledLanguages = async (db: DrizzleInstance) => {
	return db.query.languages.findMany({
		where: eq(languages.isEnabled, true),
	});
};

const applyAppLanguageState = (state: Omit<AppLanguageState, "isReady">) => {
	appLanguage$.set({
		isReady: true,
		...state,
	});
};

export const refreshAppLanguageState = async (db: DrizzleInstance) => {
	if (!inflightLoad) {
		inflightLoad = (async () => {
			try {
				await ensureRequiredAppLanguages(db);

				const [enabledLanguages, existingSetting] = await Promise.all([
					getEnabledLanguages(db),
					db.query.appSettings.findFirst({
						where: eq(appSettings.key, ACTIVE_LANGUAGE_KEY),
					}),
				]);

				const normalizedLanguages = enabledLanguages.map((language) => ({
					id: language.id,
					code: language.code,
					name: language.name,
				}));
				const requestedLanguageId = existingSetting?.value ?? DEFAULT_LANGUAGE_ID;
				const fallbackLanguageId =
					normalizedLanguages.find((language) => language.id === requestedLanguageId)
						?.id ??
					normalizedLanguages[0]?.id ??
					DEFAULT_LANGUAGE_ID;

				if (existingSetting?.value !== fallbackLanguageId) {
					await db
						.insert(appSettings)
						.values({
							key: ACTIVE_LANGUAGE_KEY,
							value: fallbackLanguageId,
						})
						.onConflictDoUpdate({
							target: appSettings.key,
							set: { value: fallbackLanguageId },
						});
				}

				applyAppLanguageState({
					activeLanguageId: fallbackLanguageId,
					availableLanguages: normalizedLanguages,
				});
			} finally {
				inflightLoad = null;
			}
		})();
	}

	await inflightLoad;
};

export const setPersistedActiveLanguageId = async (
	db: DrizzleInstance,
	languageId: string,
) => {
	await db
		.insert(appSettings)
		.values({
			key: ACTIVE_LANGUAGE_KEY,
			value: languageId,
		})
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value: languageId },
		});
	appLanguage$.activeLanguageId.set(languageId);
	appLanguage$.isReady.set(true);
};

export const AppLanguageProvider = ({
	children,
}: {
	children: React.ReactNode;
}) => {
	const db = useDrizzle();
	const isReady = useSelector(() => appLanguage$.isReady.get());

	React.useEffect(() => {
		if (!isReady) {
			void refreshAppLanguageState(db);
		}
	}, [db, isReady]);

	if (!isReady) {
		return <Text className="flex-1 pt-24 text-center">Loading settings...</Text>;
	}

	return children;
};

export const useAppLanguage = () => {
	const db = useDrizzle();
	const state = useSelector(() => ({
		isReady: appLanguage$.isReady.get(),
		activeLanguageId: appLanguage$.activeLanguageId.get(),
		availableLanguages: appLanguage$.availableLanguages.get(),
	}));

	const setActiveLanguageId = React.useCallback(
		async (languageId: string) => {
			const previousLanguageId = appLanguage$.activeLanguageId.peek();
			if (previousLanguageId === languageId && state.isReady) {
				return;
			}

			appLanguage$.activeLanguageId.set(languageId);
			appLanguage$.isReady.set(true);

			try {
				await setPersistedActiveLanguageId(db, languageId);
			} catch (error) {
				console.error("Failed to persist active language.", error);
				appLanguage$.activeLanguageId.set(previousLanguageId);
				if (!state.isReady) {
					await refreshAppLanguageState(db);
				}
			}
		},
		[db, state.isReady],
	);

	return {
		activeLanguageId: state.activeLanguageId,
		availableLanguages: state.availableLanguages,
		setActiveLanguageId,
	};
};
