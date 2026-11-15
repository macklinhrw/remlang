import * as React from "react";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useDebounceValue } from "usehooks-ts";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { searchEntries, type EntrySearchResult } from "@/lib/database/lexicon";

interface DictionarySearchState {
	search: string;
	results: EntrySearchResult[];
	isSearching: boolean;
	languageId: string | null;
	lastSettledQuery: string;
}

const defaults: DictionarySearchState = {
	search: "",
	results: [],
	isSearching: false,
	languageId: null,
	lastSettledQuery: "",
};

export const dictionarySearch$ = observable<DictionarySearchState>(defaults);

let requestCounter = 0;

export const resetDictionarySearch = (languageId: string | null) => {
	requestCounter += 1;
	dictionarySearch$.set({
		...defaults,
		languageId,
	});
};

export const setDictionarySearch = (value: string) => {
	dictionarySearch$.search.set(value);
};

export const runDictionarySearch = async ({
	db,
	query,
	languageId,
	requestId,
}: {
	db: DrizzleInstance;
	query: string;
	languageId: string;
	requestId: number;
}) => {
	try {
		const nextResults = await searchEntries(db, query, { languageId });
		if (requestId !== requestCounter) {
			return;
		}
		dictionarySearch$.results.set(nextResults);
	} catch (error) {
		if (requestId !== requestCounter) {
			return;
		}
		console.error("Error running queries:", error);
		dictionarySearch$.results.set([]);
	} finally {
		if (requestId === requestCounter) {
			dictionarySearch$.isSearching.set(false);
		}
	}
};

export const useDictionarySearch = ({
	db,
	languageId,
}: {
	db: DrizzleInstance;
	languageId: string;
}) => {
	const state = useSelector(() => ({
		search: dictionarySearch$.search.get(),
		results: dictionarySearch$.results.get(),
		isSearching: dictionarySearch$.isSearching.get(),
		languageId: dictionarySearch$.languageId.get(),
		lastSettledQuery: dictionarySearch$.lastSettledQuery.get(),
	}));

	const [debouncedSearch] = useDebounceValue(state.search, 550);
	const trimmedSearch = state.search.trim();
	const trimmedDebouncedSearch = debouncedSearch.trim();

	React.useEffect(() => {
		if (state.languageId !== languageId) {
			resetDictionarySearch(languageId);
		}
	}, [languageId, state.languageId]);

	React.useEffect(() => {
		if (state.languageId !== languageId) {
			return;
		}

		dictionarySearch$.lastSettledQuery.set(trimmedDebouncedSearch);

		if (trimmedDebouncedSearch.length === 0) {
			requestCounter += 1;
			dictionarySearch$.results.set([]);
			dictionarySearch$.isSearching.set(false);
			return;
		}

		requestCounter += 1;
		const currentRequestId = requestCounter;
		dictionarySearch$.isSearching.set(true);

		void runDictionarySearch({
			db,
			query: trimmedDebouncedSearch,
			languageId,
			requestId: currentRequestId,
		});
	}, [db, languageId, state.languageId, trimmedDebouncedSearch]);

	const setSearch = React.useCallback((value: string) => {
		setDictionarySearch(value);
	}, []);

	return {
		search: state.search,
		results: state.results,
		isSearching: state.isSearching,
		trimmedSearch,
		trimmedDebouncedSearch,
		lastSettledQuery: state.lastSettledQuery,
		setSearch,
	};
};
