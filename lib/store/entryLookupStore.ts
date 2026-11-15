import * as React from "react";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { and, eq } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { getEntryDetail, searchEntries, type EntryDetailResult } from "@/lib/database/lexicon";
import { knowledge } from "@/lib/database/schema";

interface EntryLookupState {
	requestKey: string | null;
	languageId: string | null;
	entryIdParam: string | null;
	characterParam: string | null;
	resolvedEntryId: string | null;
	entryResult: EntryDetailResult | null;
	existingKnowledgeRows: (typeof knowledge.$inferSelect)[];
	isLoading: boolean;
	errorMessage: string | null;
}

const defaults: EntryLookupState = {
	requestKey: null,
	languageId: null,
	entryIdParam: null,
	characterParam: null,
	resolvedEntryId: null,
	entryResult: null,
	existingKnowledgeRows: [],
	isLoading: false,
	errorMessage: null,
};

export const entryLookup$ = observable<EntryLookupState>(defaults);

const resolveEntryId = async ({
	db,
	entryId,
	character,
	languageId,
}: {
	db: DrizzleInstance;
	entryId?: string | null;
	character?: string | null;
	languageId: string;
}) => {
	if (entryId) {
		return entryId;
	}
	if (!character) {
		return null;
	}

	const results = await searchEntries(db, character, { languageId });
	const exactResult =
		results.find((result) => result.canonicalForm === character) ??
		results.find((result) => result.forms.some((form) => form.text === character)) ??
		null;

	return exactResult?.id ?? null;
};

export const loadEntryLookup = async ({
	db,
	requestKey,
	entryId,
	character,
	languageId,
	includeKnowledgeVariants = false,
}: {
	db: DrizzleInstance;
	requestKey: string;
	entryId?: string | null;
	character?: string | null;
	languageId: string;
	includeKnowledgeVariants?: boolean;
}) => {
	entryLookup$.set({
		...entryLookup$.peek(),
		requestKey,
		languageId,
		entryIdParam: entryId ?? null,
		characterParam: character ?? null,
		isLoading: true,
		errorMessage: null,
	});

	try {
		const resolvedEntryId = await resolveEntryId({
			db,
			entryId,
			character,
			languageId,
		});

		if (entryLookup$.requestKey.peek() !== requestKey) {
			return null;
		}

		if (!resolvedEntryId) {
			entryLookup$.set({
				...entryLookup$.peek(),
				resolvedEntryId: null,
				entryResult: null,
				existingKnowledgeRows: [],
				isLoading: false,
			});
			return null;
		}

		const [entryResult, existingKnowledgeRows] = await Promise.all([
			getEntryDetail(db, resolvedEntryId),
			includeKnowledgeVariants
				? db.query.knowledge.findMany({
						where: and(
							eq(knowledge.entryId, resolvedEntryId),
							eq(knowledge.reviewType, "Front-Back"),
						),
					})
				: Promise.resolve([] as (typeof knowledge.$inferSelect)[]),
		]);

		if (entryLookup$.requestKey.peek() !== requestKey) {
			return entryResult;
		}

		entryLookup$.set({
			...entryLookup$.peek(),
			resolvedEntryId,
			entryResult,
			existingKnowledgeRows,
			isLoading: false,
			errorMessage: entryResult ? null : "Entry not found.",
		});

		return entryResult;
	} catch (error) {
		console.error("Failed to load entry lookup.", error);
		if (entryLookup$.requestKey.peek() === requestKey) {
			entryLookup$.set({
				...entryLookup$.peek(),
				resolvedEntryId: null,
				entryResult: null,
				existingKnowledgeRows: [],
				isLoading: false,
				errorMessage: "Unable to load entry.",
			});
		}
		return null;
	}
};

export const useEntryLookup = ({
	db,
	requestKey,
	entryId,
	character,
	languageId,
	includeKnowledgeVariants = false,
	refreshToken,
}: {
	db: DrizzleInstance;
	requestKey: string;
	entryId?: string | null;
	character?: string | null;
	languageId: string;
	includeKnowledgeVariants?: boolean;
	refreshToken?: string | number | null;
}) => {
	const state = useSelector(() => ({
		requestKey: entryLookup$.requestKey.get(),
		languageId: entryLookup$.languageId.get(),
		entryIdParam: entryLookup$.entryIdParam.get(),
		characterParam: entryLookup$.characterParam.get(),
		resolvedEntryId: entryLookup$.resolvedEntryId.get(),
		entryResult: entryLookup$.entryResult.get(),
		existingKnowledgeRows: entryLookup$.existingKnowledgeRows.get(),
		isLoading: entryLookup$.isLoading.get(),
		errorMessage: entryLookup$.errorMessage.get(),
	}));

	const load = React.useCallback(
		async () =>
			loadEntryLookup({
				db,
				requestKey,
				entryId,
				character,
				languageId,
				includeKnowledgeVariants,
			}),
		[character, db, entryId, includeKnowledgeVariants, languageId, requestKey],
	);

	React.useEffect(() => {
		const needsLoad =
			state.requestKey !== requestKey ||
			state.languageId !== languageId ||
			state.entryIdParam !== (entryId ?? null) ||
			state.characterParam !== (character ?? null);

		if (needsLoad) {
			void load();
		}
	}, [
		character,
		entryId,
		languageId,
		load,
		requestKey,
		state.characterParam,
		state.entryIdParam,
		state.languageId,
		state.requestKey,
	]);

	React.useEffect(() => {
		if (state.requestKey === requestKey) {
			void load();
		}
	}, [load, refreshToken, requestKey, state.requestKey]);

	return {
		...state,
		refresh: load,
	};
};
