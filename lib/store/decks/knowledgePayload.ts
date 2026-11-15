/** Builds knowledge rows for cards added from the dictionary or premade decks, and resolves which review types an entry supports. */
import { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { getEntryDetail, type EntryDetailResult } from "@/lib/database/lexicon";
import { knowledge, type ReviewType } from "@/lib/database/schema";
import {
	DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
	type KnowledgeDefinitionConfig,
	buildKnowledgeConfigSignature,
	getDefaultKnowledgeDefinitionConfig,
	getGlossKey,
	getKnowledgeDefinitionTexts,
	serializeKnowledgeDefinitionConfig,
} from "@/lib/knowledge/config";
import type { PremadeDeckItem } from "@/lib/premadeDecks/types";
import { getReviewTypeLabel } from "@/lib/review/fsrs";
import { hasPitchAccentReviewSupport } from "@/lib/review/pitchEligibility";
import { hasStrokeEligibleCharacters } from "@/lib/review/strokeEligibility";

export const buildKnowledgePayload = (
	entry: EntryDetailResult,
	config?: KnowledgeDefinitionConfig | null,
) => {
	const front = entry.canonicalForm ?? entry.forms[0]?.text ?? entry.id;
	const definitions = getKnowledgeDefinitionTexts(entry, config).join("\n");

	return {
		front,
		definitions: definitions || "No definition available.",
		sourceDefinitions: null,
		pronunciation: entry.canonicalReading ?? null,
		configSignature: buildKnowledgeConfigSignature(entry, config),
		definitionConfig: serializeKnowledgeDefinitionConfig(entry, config),
	};
};

const buildKnowledgeConfigFromSenseIds = (
	entry: EntryDetailResult,
	senseIds: string[],
): KnowledgeDefinitionConfig | null => {
	const selectedSenseIds = entry.senses
		.filter((sense) => senseIds.includes(sense.id))
		.map((sense) => sense.id);

	if (selectedSenseIds.length === 0) {
		return null;
	}

	return {
		selectedSenseIds,
		selectedGlossKeys: entry.senses
			.filter((sense) => selectedSenseIds.includes(sense.id))
			.flatMap((sense) =>
				sense.glosses.map((gloss) =>
					getGlossKey(sense.id, gloss.glossOrder, gloss.glossLanguage),
				),
			),
	};
};

const trimOrNull = (value: string | null | undefined) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
};

export const buildPremadeKnowledgePayload = ({
	item,
	entry,
}: {
	item: PremadeDeckItem;
	entry: EntryDetailResult | null;
}) => {
	const trustedEntryId = item.dictionaryLink?.entryId && entry?.id === item.dictionaryLink.entryId
		? entry.id
		: null;
	const sourceDefinitions = trimOrNull(item.sourceDefinitions) ?? item.english.trim();

	if (!trustedEntryId || !entry || !item.dictionaryLink) {
		return {
			front: item.front,
			definitions: sourceDefinitions || "No definition available.",
			sourceDefinitions,
			pronunciation: trimOrNull(item.pronunciation),
			entryId: null,
			configSignature: DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
			definitionConfig: null,
		};
	}

	if (!item.dictionaryLink.usesAllSenses && item.dictionaryLink.senseIds.length > 0) {
		const config = buildKnowledgeConfigFromSenseIds(entry, item.dictionaryLink.senseIds);
		const definitions = config ? getKnowledgeDefinitionTexts(entry, config).join("\n").trim() : "";

		return {
			front: entry.canonicalForm ?? item.front,
			definitions: definitions || sourceDefinitions || "No definition available.",
			sourceDefinitions,
			pronunciation: trimOrNull(entry.canonicalReading) ?? trimOrNull(item.pronunciation),
			entryId: entry.id,
			configSignature: config
				? buildKnowledgeConfigSignature(entry, config)
				: DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
			definitionConfig: config ? serializeKnowledgeDefinitionConfig(entry, config) : null,
		};
	}

	const defaultConfig = getDefaultKnowledgeDefinitionConfig(entry);

	return {
		front: entry.canonicalForm ?? item.front,
		definitions: sourceDefinitions || "No definition available.",
		sourceDefinitions,
		pronunciation: trimOrNull(entry.canonicalReading) ?? trimOrNull(item.pronunciation),
		entryId: entry.id,
		configSignature: DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
		definitionConfig: serializeKnowledgeDefinitionConfig(entry, defaultConfig),
	};
};

export const buildMirroredKnowledgeValues = ({
	sourceKnowledge,
	targetReviewType,
}: {
	sourceKnowledge: typeof knowledge.$inferSelect;
	targetReviewType: string;
}) => ({
	front: sourceKnowledge.front,
	definitions: sourceKnowledge.definitions,
	sourceDefinitions: sourceKnowledge.sourceDefinitions,
	pronunciation: sourceKnowledge.pronunciation,
	wordId: sourceKnowledge.wordId,
	entryId: sourceKnowledge.entryId,
	focus: sourceKnowledge.focus,
	showFocus: sourceKnowledge.showFocus,
	focusAllowsDuplicates: sourceKnowledge.focusAllowsDuplicates,
	note: sourceKnowledge.note,
	tags: sourceKnowledge.tags,
	primaryPitchAccentDictionaryId: sourceKnowledge.primaryPitchAccentDictionaryId,
	primaryPitchAccentReading: sourceKnowledge.primaryPitchAccentReading,
	primaryPitchAccentAccentNumber: sourceKnowledge.primaryPitchAccentAccentNumber,
	primaryPitchAccentIsCustom: sourceKnowledge.primaryPitchAccentIsCustom,
	configSignature: sourceKnowledge.configSignature ?? DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
	definitionConfig: sourceKnowledge.definitionConfig,
	configLabel: sourceKnowledge.configLabel,
	reviewType: targetReviewType,
	deleted: false,
	suspended: sourceKnowledge.suspended ?? false,
});

export const resolveLinkedDeckName = (primaryDeckName: string, targetReviewType: string) =>
	`${primaryDeckName} · ${getReviewTypeLabel(targetReviewType as ReviewType)}`;

const supportsStrokeReviewType = (front: string) => hasStrokeEligibleCharacters(front);

export const supportsReviewTypeForEntry = ({
	reviewType,
	entry,
	front,
}: {
	reviewType: string;
	entry: EntryDetailResult | null;
	front: string;
}) => {
	if (reviewType === "Stroke") {
		return supportsStrokeReviewType(front);
	}

	if (reviewType === "Pitch") {
		return hasPitchAccentReviewSupport(entry);
	}

	return true;
};

export const createReviewTypeSupportResolver = (db: DrizzleInstance) => {
	const pitchSupportByEntryId = new Map<string, Promise<boolean> | boolean>();

	return async ({
		reviewType,
		sourceKnowledge,
	}: {
		reviewType: string;
		sourceKnowledge: typeof knowledge.$inferSelect;
	}) => {
		if (reviewType === "Stroke") {
			return supportsStrokeReviewType(sourceKnowledge.front);
		}

		if (reviewType !== "Pitch") {
			return true;
		}

		if (!sourceKnowledge.entryId) {
			return false;
		}

		const cached = pitchSupportByEntryId.get(sourceKnowledge.entryId);
		if (cached !== undefined) {
			return await cached;
		}

		const nextSupport = getEntryDetail(db, sourceKnowledge.entryId)
			.then((entry) => hasPitchAccentReviewSupport(entry))
			.catch(() => false);
		pitchSupportByEntryId.set(sourceKnowledge.entryId, nextSupport);
		const resolvedSupport = await nextSupport;
		pitchSupportByEntryId.set(sourceKnowledge.entryId, resolvedSupport);
		return resolvedSupport;
	};
};
