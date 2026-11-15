import type { EntryDetailResult } from "@/lib/database/lexicon";

export const DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE = "__all__";

export type KnowledgeDefinitionConfig = {
	selectedSenseIds: string[];
	selectedGlossKeys: string[];
};

export const getGlossKey = (
	senseId: string,
	glossOrder: number,
	glossLanguage: string,
) => `${senseId}::${glossLanguage}::${glossOrder}`;

const getAllGlossKeys = (entry: EntryDetailResult) =>
	entry.senses.flatMap((sense) =>
		sense.glosses.map((gloss) =>
			getGlossKey(sense.id, gloss.glossOrder, gloss.glossLanguage),
		),
	);

const getAllSenseIds = (entry: EntryDetailResult) => entry.senses.map((sense) => sense.id);

export const getDefaultKnowledgeDefinitionConfig = (
	entry: EntryDetailResult,
): KnowledgeDefinitionConfig => ({
	selectedSenseIds: getAllSenseIds(entry),
	selectedGlossKeys: getAllGlossKeys(entry),
});

export const normalizeKnowledgeDefinitionConfig = (
	entry: EntryDetailResult,
	config?: KnowledgeDefinitionConfig | null,
): KnowledgeDefinitionConfig => {
	const allSenseIds = new Set(getAllSenseIds(entry));
	const allGlossKeys = new Set(getAllGlossKeys(entry));
	const selectedSenseIds = [...new Set(config?.selectedSenseIds ?? getAllSenseIds(entry))].filter(
		(senseId) => allSenseIds.has(senseId),
	);
	const selectedGlossKeys = [...new Set(config?.selectedGlossKeys ?? getAllGlossKeys(entry))].filter(
		(glossKey) => allGlossKeys.has(glossKey),
	);

	const selectedSenseIdSet = new Set(selectedSenseIds);
	const selectedGlossesFromSelectedSenses = entry.senses
		.filter((sense) => selectedSenseIdSet.has(sense.id))
		.flatMap((sense) =>
			sense.glosses
				.map((gloss) => getGlossKey(sense.id, gloss.glossOrder, gloss.glossLanguage))
				.filter((glossKey) => selectedGlossKeys.includes(glossKey)),
		);

	return {
		selectedSenseIds,
		selectedGlossKeys: selectedGlossesFromSelectedSenses,
	};
};

export const getKnowledgeDefinitionTexts = (
	entry: EntryDetailResult,
	config?: KnowledgeDefinitionConfig | null,
) => {
	const normalized = normalizeKnowledgeDefinitionConfig(entry, config);
	const selectedGlossSet = new Set(normalized.selectedGlossKeys);

	return entry.senses.flatMap((sense) =>
		sense.glosses
			.filter((gloss) =>
				selectedGlossSet.has(getGlossKey(sense.id, gloss.glossOrder, gloss.glossLanguage)),
			)
			.map((gloss) => gloss.text),
	);
};

export const getConfiguredSenses = (
	entry: EntryDetailResult,
	config?: KnowledgeDefinitionConfig | null,
) => {
	const normalized = normalizeKnowledgeDefinitionConfig(entry, config);
	const selectedSenseSet = new Set(normalized.selectedSenseIds);
	const selectedGlossSet = new Set(normalized.selectedGlossKeys);

	return entry.senses
		.filter((sense) => selectedSenseSet.has(sense.id))
		.map((sense) => ({
			...sense,
			glosses: sense.glosses.filter((gloss) =>
				selectedGlossSet.has(
					getGlossKey(sense.id, gloss.glossOrder, gloss.glossLanguage),
				),
			),
		}))
		.filter((sense) => sense.glosses.length > 0);
};

export const buildKnowledgeConfigSignature = (
	entry: EntryDetailResult,
	config?: KnowledgeDefinitionConfig | null,
) => {
	const normalized = normalizeKnowledgeDefinitionConfig(entry, config);
	const defaultConfig = getDefaultKnowledgeDefinitionConfig(entry);

	const hasAllSenses =
		normalized.selectedSenseIds.length === defaultConfig.selectedSenseIds.length &&
		normalized.selectedSenseIds.every((senseId) =>
			defaultConfig.selectedSenseIds.includes(senseId),
		);
	const hasAllGlosses =
		normalized.selectedGlossKeys.length === defaultConfig.selectedGlossKeys.length &&
		normalized.selectedGlossKeys.every((glossKey) =>
			defaultConfig.selectedGlossKeys.includes(glossKey),
		);

	if (hasAllSenses && hasAllGlosses) {
		return DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE;
	}

	return normalized.selectedGlossKeys.slice().sort().join("|");
};

export const serializeKnowledgeDefinitionConfig = (
	entry: EntryDetailResult,
	config?: KnowledgeDefinitionConfig | null,
) => JSON.stringify(normalizeKnowledgeDefinitionConfig(entry, config));

export const parseKnowledgeDefinitionConfig = (
	value: string | null | undefined,
): KnowledgeDefinitionConfig | null => {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value);
		if (
			parsed &&
			Array.isArray(parsed.selectedSenseIds) &&
			Array.isArray(parsed.selectedGlossKeys)
		) {
			return {
				selectedSenseIds: parsed.selectedSenseIds.filter((item: unknown) => typeof item === "string"),
				selectedGlossKeys: parsed.selectedGlossKeys.filter((item: unknown) => typeof item === "string"),
			};
		}
	} catch {
		return null;
	}

	return null;
};

export const getNextKnowledgeConfigLabel = (existingLabels: Array<string | null | undefined>) => {
	const normalizedExisting = existingLabels.filter(
		(label): label is string => typeof label === "string" && label.length > 0,
	);
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	let index = 0;

	while (index < 1024) {
		let value = index;
		let label = "";

		do {
			label = alphabet[value % 26] + label;
			value = Math.floor(value / 26) - 1;
		} while (value >= 0);

		if (!normalizedExisting.includes(label)) {
			return label;
		}

		index += 1;
	}

	return String(normalizedExisting.length + 1);
};
