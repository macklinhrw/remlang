import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
	ArrowUpRight,
	ChevronLeft,
	ChevronRight,
} from "lucide-react-native";
import pinyin_tone from "pinyin-tone";
import StrokeCanvas from "@/components/drawing/stroke-canvas";
import { PitchAccentSection } from "@/components/japanese/pitch-accent-section";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import type { EntryDetailResult } from "@/lib/database/lexicon";
import {
	getCharacterSvg,
	type CharacterLanguageId,
} from "@/lib/hooks/useZhSvg";
import {
	DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
	getConfiguredSenses,
	parseKnowledgeDefinitionConfig,
} from "@/lib/knowledge/config";
import { getKnowledgeRoute, type KnowledgeOriginPath } from "@/lib/knowledge/routes";
import { cn } from "@/lib/utils";
import { useAppLanguage } from "@/lib/store/appLanguageStore";
import {
	REVIEW_GRADES,
	type ReviewQueueCard,
	type KnowledgeReviewPreview,
	intervalLabelFromDates,
} from "@/lib/review/fsrs";

// --- Types ---

export type ReviewCard = NonNullable<ReviewQueueCard>;

export type CharacterBackTarget = KnowledgeOriginPath;

// --- Helpers ---

export const getKnowledgeVariantLabel = (
	item: Pick<ReviewCard["knowledge"], "configLabel" | "id">,
) => item.configLabel ?? item.id.slice(0, 4).toUpperCase();

const isStrokePracticeCharacter = (value: string) => /\p{Script=Han}/u.test(value);
const hasKanjiCharacters = (value: string) => /\p{Script=Han}/u.test(value);
const hasPitchAccent = (entry: EntryDetailResult | null | undefined) =>
	Boolean(entry && entry.languageId === "lang_ja" && entry.pitchAccents.length > 0);

const formatPronunciation = (value: string | null | undefined) => {
	if (!value) return null;
	if (/^[a-z0-9\s:]+$/i.test(value)) {
		return pinyin_tone(value);
	}
	return value;
};

const normalizeComparableText = (value: string | null | undefined) =>
	(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim();

const hasDistinctPronunciation = ({
	front,
	pronunciation,
}: {
	front: string;
	pronunciation: string | null | undefined;
}) =>
	Boolean(normalizeComparableText(pronunciation)) &&
	normalizeComparableText(pronunciation) !== normalizeComparableText(front);

const PART_OF_SPEECH_LABELS: Record<string, string> = {
	"adj-f": "Prenominal adjective",
	"adj-i": "I-adjective",
	"adj-na": "Na-adjective",
	"adj-no": "Noun modifier",
	adj: "Adjective",
	adv: "Adverb",
	aux: "Auxiliary",
	ctr: "Counter",
	exp: "Expression",
	int: "Interjection",
	n: "Noun",
	pn: "Pronoun",
	pref: "Prefix",
	prt: "Particle",
	suf: "Suffix",
	v1: "Ichidan verb",
	v5: "Godan verb",
	vi: "Intransitive verb",
	vs: "Suru verb",
	vt: "Transitive verb",
};

const parseJsonArray = <T,>(value: string | null | undefined): T[] => {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
};

const formatPartOfSpeech = (value: string | null | undefined) => {
	if (!value) return null;
	const parsed = parseJsonArray<string>(value);
	const parts = (parsed.length > 0 ? parsed : [value])
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => PART_OF_SPEECH_LABELS[part] ?? part);
	const uniqueParts = [...new Set(parts)];
	return uniqueParts.length > 0 ? uniqueParts.join(" • ") : null;
};

const hasStructuredSenses = (entry: Pick<EntryDetailResult, "senses">) =>
	entry.senses.some((sense) => {
		const hasPartOfSpeech = Boolean(sense.partOfSpeech?.trim());
		const hasMultipleGlosses = sense.glosses.length > 1;
		return hasPartOfSpeech || hasMultipleGlosses;
	});

const RATING_STYLES = {
	Again: {
		border: "border-red-500/40",
		bg: "bg-red-500/[0.08]",
		label: "text-red-200",
		meta: "text-red-200/80",
	},
	Hard: {
		border: "border-orange-500/40",
		bg: "bg-orange-500/[0.08]",
		label: "text-orange-100",
		meta: "text-orange-100/80",
	},
	Good: {
		border: "border-emerald-500/40",
		bg: "bg-emerald-500/[0.08]",
		label: "text-emerald-100",
		meta: "text-emerald-100/80",
	},
	Easy: {
		border: "border-violet-500/40",
		bg: "bg-violet-500/[0.08]",
		label: "text-violet-100",
		meta: "text-violet-100/80",
	},
} as const;

// --- Components ---

const ReviewReadingDisplay = ({
	front,
	pronunciation,
	isJapanese,
}: {
	front: string;
	pronunciation: string | null;
	isJapanese: boolean;
}) => {
	const hasDistinctReading = hasDistinctPronunciation({ front, pronunciation });
	const shouldUseRubyStyle = isJapanese && hasKanjiCharacters(front) && hasDistinctReading;
	const plainReading = pronunciation ?? front;

	if (shouldUseRubyStyle) {
		return (
			<View className="items-center self-stretch">
				<Text className="text-sm font-medium leading-5 text-zinc-300">
					{pronunciation}
				</Text>
				<Text className="mt-0.5 text-center text-[42px] font-semibold leading-[48px] text-zinc-100">
					{front}
				</Text>
			</View>
		);
	}

	return (
		<Text className="text-center text-[42px] font-semibold leading-[48px] text-zinc-100">
			{plainReading}
		</Text>
	);
};

export const Pill = ({ children }: { children: React.ReactNode }) => (
	<View className="rounded-lg border border-white/8 bg-[#121315] px-2 py-0.5">
		<Text className="text-[11px] font-medium text-zinc-400">{children}</Text>
	</View>
);

export const ReviewPromptCard = memo(function ReviewPromptCard({
	card,
}: {
	card: ReviewCard;
}) {
	const drizzle = useDrizzle();
	const pronunciation = formatPronunciation(card.knowledge.pronunciation);
	const reviewType = card.knowledge.reviewType;
	const strokeCharacters = useMemo(
		() => Array.from(card.knowledge.front).filter(isStrokePracticeCharacter),
		[card.knowledge.front],
	);
	const strokeCharactersKey = strokeCharacters.join("");
	const [strokeCharacterIndex, setStrokeCharacterIndex] = useState(0);
	const strokeCharacter = strokeCharacters[strokeCharacterIndex] ?? "";
	const strokeLanguageId = useMemo<CharacterLanguageId | null>(() => {
		if (card.entryDetail?.languageId === "lang_ja") return "lang_ja";
		if (card.entryDetail?.languageId === "lang_zh") return "lang_zh";
		return null;
	}, [card.entryDetail?.languageId]);
	const strokeAssetKey =
		reviewType === "Stroke" && strokeCharacter && strokeLanguageId
			? `${strokeLanguageId}:${strokeCharacter}`
			: null;
	const [strokeSvgStatuses, setStrokeSvgStatuses] = useState<
		Record<string, boolean | null>
	>({});
	const hasStrokeSvg =
		strokeCharacter && strokeAssetKey ? (strokeSvgStatuses[strokeCharacter] ?? null) : null;
	const shouldShowPromptPronunciation = hasDistinctPronunciation({
		front: card.knowledge.front,
		pronunciation,
	});
	const multipleStrokeCharacters = strokeCharacters.length > 1;

	useEffect(() => {
		setStrokeCharacterIndex(0);
	}, [card.id, strokeCharactersKey]);

	useFocusEffect(
		useCallback(() => {
			setStrokeCharacterIndex(0);
		}, []),
	);

	useEffect(() => {
		let cancelled = false;

		const preloadStrokeSvgs = async () => {
			if (reviewType !== "Stroke" || strokeCharacters.length === 0 || !strokeLanguageId) {
				setStrokeSvgStatuses({});
				return;
			}

			const uniqueCharacters = Array.from(new Set(strokeCharacters));
			setStrokeSvgStatuses(
				Object.fromEntries(uniqueCharacters.map((character) => [character, null])),
			);

			try {
				const results = await Promise.all(
					uniqueCharacters.map(async (character) => {
						try {
							const result = await getCharacterSvg(drizzle, character, strokeLanguageId);
							return [character, Boolean(result?.svg)] as const;
						} catch (error) {
							console.error("Failed to load stroke SVG for review card.", error);
							return [character, false] as const;
						}
					}),
				);

				if (!cancelled) {
					setStrokeSvgStatuses(Object.fromEntries(results));
				}
			} catch {
				if (!cancelled) {
					setStrokeSvgStatuses(
						Object.fromEntries(
							uniqueCharacters.map((character) => [character, false]),
						),
					);
				}
			}
		};

		void preloadStrokeSvgs();

		return () => {
			cancelled = true;
		};
	}, [drizzle, reviewType, strokeCharacters, strokeLanguageId]);

	if (reviewType === "Stroke" && card.knowledge.front.length > 0) {
		return (
			<View className="items-center">
				{strokeCharacters.length === 0 ? (
					<View className="rounded-xl border border-white/8 bg-[#121315] px-3 py-3">
						<Text className="text-sm leading-5 text-zinc-400">
							Stroke practice is only available for Chinese and Japanese characters on this card.
						</Text>
					</View>
				) : (
					<View className="items-center overflow-hidden">
						{hasStrokeSvg ? (
							<StrokeCanvas
								character={strokeCharacter}
								languageId={strokeLanguageId ?? undefined}
								width={320}
								height={320}
								showTotalStrokes={false}
							/>
						) : (
							<View className="flex-1 items-center justify-center px-4 py-6">
								{hasStrokeSvg === null ? (
									<>
										<ActivityIndicator color="#A1A1AA" />
										<Text className="mt-3 text-center text-sm leading-5 text-zinc-400">
											Loading stroke-order data...
										</Text>
									</>
								) : (
									<Text className="text-center text-sm leading-5 text-zinc-400">
										{!strokeLanguageId
											? "Stroke practice is not available for this entry because we could not determine a supported stroke dataset."
											: `No stroke-order SVG data is available for ${strokeCharacter}.`}
									</Text>
								)}
							</View>
						)}
					</View>
				)}
				{multipleStrokeCharacters ? (
					<View className="mt-2 w-full flex-row items-center justify-between gap-2">
						<Button
							onPress={() =>
								setStrokeCharacterIndex((current) =>
									current <= 0 ? strokeCharacters.length - 1 : current - 1,
								)
							}
							size="icon"
							className="h-14 w-14 rounded-xl border border-white/8 bg-[#15171A]"
						>
							<ChevronLeft size={18} color="#E4E4E7" />
						</Button>
						<Text className="text-xs text-zinc-400">
							Character {strokeCharacterIndex + 1} / {strokeCharacters.length}
						</Text>
						<Button
							onPress={() =>
								setStrokeCharacterIndex((current) =>
									current >= strokeCharacters.length - 1 ? 0 : current + 1,
								)
							}
							size="icon"
							className="h-14 w-14 rounded-xl border border-white/8 bg-[#15171A]"
						>
							<ChevronRight size={18} color="#E4E4E7" />
						</Button>
					</View>
				) : strokeCharacters.length === 1 ? (
					<Text className="mt-2 text-xs text-zinc-500">Character 1 / 1</Text>
				) : null}
				{shouldShowPromptPronunciation ? (
					<Text className="mt-2 text-sm text-zinc-400">{pronunciation}</Text>
				) : null}
			</View>
		);
	}

	if (reviewType === "Back-Front") {
		return (
			<View className="rounded-2xl border border-white/8 bg-[#121315] px-5 py-4">
				<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
					Front
				</Text>
				<ReviewBackContent card={card} className="mt-4" showPronunciation={false} showPitchAccent={false} />
			</View>
		);
	}

	if (reviewType === "Pitch") {
		return (
			<View className="rounded-2xl border border-white/8 bg-[#121315] px-5 py-4">
				<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
					Front
				</Text>
				<View className="mt-2">
					<ReviewReadingDisplay
						front={card.knowledge.front}
						pronunciation={pronunciation}
						isJapanese={card.entryDetail?.languageId === "lang_ja"}
					/>
				</View>
			</View>
		);
	}

	return (
		<View className="rounded-2xl border border-white/8 bg-[#121315] px-5 py-5">
			<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
				Front
			</Text>
			<Text className="mt-4 text-center text-[44px] font-semibold leading-[50px] text-zinc-100">
				{card.knowledge.front}
			</Text>
		</View>
	);
}, (prevProps, nextProps) => prevProps.card.id === nextProps.card.id);

const ReviewBackContent = ({
	card,
	className,
	showPronunciation = true,
	showPitchAccent = true,
}: {
	card: ReviewCard;
	className?: string;
	showPronunciation?: boolean;
	showPitchAccent?: boolean;
}) => {
	const pronunciation = formatPronunciation(card.knowledge.pronunciation);
	const shouldShowPronunciation = hasDistinctPronunciation({
		front: card.knowledge.front,
		pronunciation,
	});
	const definitions = card.knowledge.definitions
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const sourceDefinitions = (card.knowledge.sourceDefinitions ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const entryDetail = card.entryDetail;
	const configuredSenses = useMemo(() => {
		if (!entryDetail) return [];
		return getConfiguredSenses(
			entryDetail,
			parseKnowledgeDefinitionConfig(card.knowledge.definitionConfig),
		);
	}, [card.knowledge.definitionConfig, entryDetail]);
	const shouldPreferTextbookDefinitions =
		Boolean(card.knowledge.entryId) &&
		sourceDefinitions.length > 0 &&
		(card.knowledge.configSignature ?? DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE) ===
			DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE &&
		sourceDefinitions.join("\n") === definitions.join("\n");
	const shouldUseStructuredSenses =
		!shouldPreferTextbookDefinitions &&
		configuredSenses.length > 0 && hasStructuredSenses({ senses: configuredSenses });
	const showTextbookReference =
		sourceDefinitions.length > 0 && sourceDefinitions.join("\n") !== definitions.join("\n");

	const renderStructuredSenses = (senses: typeof configuredSenses) =>
		senses.map((sense, index) => {
			const senseTitle = formatPartOfSpeech(sense.partOfSpeech) ?? "Definition";
			return (
				<View
					key={`${card.id}-sense-${sense.id}`}
					className={cn(index > 0 && "border-t border-white/6 pt-3")}
				>
					<View className="mb-2 flex-row items-center gap-2">
						<Text className="text-xs font-medium text-zinc-400">
							{senseTitle}
						</Text>
					</View>
					<View>
						{sense.glosses.map((gloss, glossIndex) => (
							<View
								key={`${card.id}-sense-${sense.id}-gloss-${gloss.glossOrder}`}
								className="flex-row items-start gap-2.5 py-1.5"
							>
								<Text className="text-[15px] leading-[22px] text-zinc-500">
									{glossIndex + 1}.
								</Text>
								<Text className="min-w-0 flex-1 text-[15px] leading-[22px] text-zinc-200">
									{gloss.text}
								</Text>
							</View>
						))}
					</View>
				</View>
			);
		});

	return (
		<View className={className}>
			{showPronunciation && shouldShowPronunciation ? (
				<Text className="text-2xl font-medium text-zinc-100">{pronunciation}</Text>
			) : null}
			<View
				className={cn(
					"gap-3",
					showPronunciation && shouldShowPronunciation
						? "mt-4"
						: undefined,
				)}
			>
				{shouldUseStructuredSenses ? (
					renderStructuredSenses(configuredSenses)
				) : (
					(shouldPreferTextbookDefinitions ? sourceDefinitions : definitions).map(
						(definition, index) => (
							<View
								key={`${card.id}-definition-${index}`}
								className="flex-row items-start gap-2.5"
							>
								<Text className="text-[15px] leading-[22px] text-zinc-500">
									{index + 1}.
								</Text>
								<Text className="min-w-0 flex-1 text-[15px] leading-[22px] text-zinc-200">
									{definition}
								</Text>
							</View>
						),
					)
				)}
			</View>

			{shouldPreferTextbookDefinitions && configuredSenses.length > 0 ? (
				<View className="mt-4 border-t border-white/8 pt-4">
					<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
						Dictionary Entry
					</Text>
					<View className="mt-3 gap-3">{renderStructuredSenses(configuredSenses)}</View>
				</View>
			) : null}

			{showTextbookReference ? (
				<View className="mt-4 border-t border-white/8 pt-4">
					<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
						Textbook Definition
					</Text>
					<View className="mt-3 gap-3">
						{sourceDefinitions.map((definition, index) => (
							<View
								key={`${card.id}-source-definition-${index}`}
								className="flex-row items-start gap-2.5"
							>
								<Text className="text-[15px] leading-[22px] text-zinc-500">
									{index + 1}.
								</Text>
								<Text className="min-w-0 flex-1 text-[15px] leading-[22px] text-zinc-300">
									{definition}
								</Text>
							</View>
						))}
					</View>
				</View>
			) : null}

			{showPitchAccent && hasPitchAccent(entryDetail) ? (
				<PitchAccentSection
					pitchAccents={entryDetail!.pitchAccents}
					primaryOverride={card.knowledge}
					preferredReading={entryDetail!.canonicalReading}
					className="mt-4"
				/>
			) : null}

			{card.knowledge.note ? (
				<View className="mt-4 border-t border-white/8 pt-4">
					<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
						Note
					</Text>
					<Text className="mt-2 text-sm leading-6 text-zinc-300">
						{card.knowledge.note}
					</Text>
				</View>
			) : null}
		</View>
	);
};

export const ReviewAnswerCard = memo(function ReviewAnswerCard({
	card,
	originPath,
	originDeckId,
	originDeckName,
}: {
	card: ReviewCard;
	originPath: CharacterBackTarget;
	originDeckId?: string | null;
	originDeckName?: string | null;
}) {
	const router = useRouter();
	const { activeLanguageId } = useAppLanguage();
	const [showDeferredPitchAccent, setShowDeferredPitchAccent] = useState(false);
	const entryId = card.knowledge.entryId;
	const knowledgeId = card.knowledge.id;
	const pronunciation = formatPronunciation(card.knowledge.pronunciation);
	const shouldShowPronunciation = hasDistinctPronunciation({
		front: card.knowledge.front,
		pronunciation,
	});
	const isJapaneseCard =
		card.entryDetail?.languageId === "lang_ja" || activeLanguageId === "lang_ja";
	const shouldShowRubyReading =
		card.knowledge.reviewType === "Stroke" &&
		shouldShowPronunciation;

	useEffect(() => {
		setShowDeferredPitchAccent(false);

		if (!hasPitchAccent(card.entryDetail)) {
			return;
		}

		let cancelled = false;
		const idleHandle =
			typeof globalThis.requestIdleCallback === "function"
				? globalThis.requestIdleCallback(() => {
						if (!cancelled) {
							setShowDeferredPitchAccent(true);
						}
					})
				: null;
		const timeoutHandle =
			idleHandle === null
				? setTimeout(() => {
						if (!cancelled) {
							setShowDeferredPitchAccent(true);
						}
					}, 32)
				: null;

		return () => {
			cancelled = true;
			if (
				idleHandle !== null &&
				typeof globalThis.cancelIdleCallback === "function"
			) {
				globalThis.cancelIdleCallback(idleHandle);
			}
			if (timeoutHandle !== null) {
				clearTimeout(timeoutHandle);
			}
		};
	}, [card.entryDetail, card.id]);

	if (card.knowledge.reviewType === "Stroke") {
		return (
			<View className="rounded-xl border border-white/8 bg-[#121315] px-4 py-3">
				<View className="flex-row items-start justify-between gap-2">
					<View className="min-w-0 flex-1">
						<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
							Back
						</Text>
						<View className="mt-3 items-center self-stretch">
							{shouldShowRubyReading ? (
								<Text className="text-base font-medium text-zinc-400">
									{pronunciation}
								</Text>
							) : null}
							<Text
								className={cn(
									"text-center text-[44px] font-semibold leading-[50px] text-zinc-100",
									shouldShowRubyReading ? "mt-1" : undefined,
								)}
							>
								{card.knowledge.front}
							</Text>
						</View>
					</View>
					{entryId ? (
						<TouchableOpacity
							activeOpacity={0.85}
							className="h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-[#17191c]"
							onPress={() =>
								router.push(
									getKnowledgeRoute(knowledgeId, {
										cardId: card.id,
										deckId: originDeckId ?? card.deckId,
										deckName: originDeckName ?? null,
										originPath,
									}),
								)
							}
						>
							<ArrowUpRight size={15} color="#E4E4E7" />
						</TouchableOpacity>
					) : null}
				</View>

				<ReviewBackContent
					card={card}
					className="mt-4"
					showPronunciation={false}
					showPitchAccent={showDeferredPitchAccent}
				/>
			</View>
		);
	}

	if (card.knowledge.reviewType === "Back-Front") {
		return (
			<View className="rounded-xl border border-white/8 bg-[#121315] px-4 py-3">
				<View className="flex-row items-start justify-between gap-2">
					<View className="min-w-0 flex-1">
						<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
							Back
						</Text>
						<View className="mt-2">
							<ReviewReadingDisplay
								front={card.knowledge.front}
								pronunciation={pronunciation}
								isJapanese={isJapaneseCard}
							/>
						</View>
					</View>
					{entryId ? (
						<TouchableOpacity
							activeOpacity={0.85}
							className="h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-[#17191c]"
							onPress={() =>
								router.push(
									getKnowledgeRoute(knowledgeId, {
										cardId: card.id,
										deckId: originDeckId ?? card.deckId,
										deckName: originDeckName ?? null,
										originPath,
									}),
								)
							}
						>
							<ArrowUpRight size={15} color="#E4E4E7" />
						</TouchableOpacity>
					) : null}
				</View>
				{hasPitchAccent(card.entryDetail) && showDeferredPitchAccent ? (
					<PitchAccentSection
						pitchAccents={card.entryDetail!.pitchAccents}
						primaryOverride={card.knowledge}
						preferredReading={card.entryDetail!.canonicalReading}
						className="mt-3"
					/>
				) : null}
			</View>
		);
	}

	if (card.knowledge.reviewType === "Pitch") {
		return (
			<View className="rounded-xl border border-white/8 bg-[#121315] px-4 py-3">
				<View className="flex-row items-start justify-between gap-2">
					<View className="min-w-0 flex-1">
						<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
							Back
						</Text>
					</View>
					{entryId ? (
						<TouchableOpacity
							activeOpacity={0.85}
							className="h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-[#17191c]"
							onPress={() =>
								router.push(
									getKnowledgeRoute(knowledgeId, {
										cardId: card.id,
										deckId: originDeckId ?? card.deckId,
										deckName: originDeckName ?? null,
										originPath,
									}),
								)
							}
						>
							<ArrowUpRight size={15} color="#E4E4E7" />
						</TouchableOpacity>
					) : null}
				</View>
				{hasPitchAccent(card.entryDetail) && showDeferredPitchAccent ? (
					<PitchAccentSection
						pitchAccents={card.entryDetail!.pitchAccents}
						primaryOverride={card.knowledge}
						preferredReading={card.entryDetail!.canonicalReading}
						className="mt-3 border-t-0 pt-0"
					/>
				) : (
					<View className="mt-3 rounded-xl border border-white/8 bg-[#17191c] px-3 py-3">
						<Text className="text-sm leading-5 text-zinc-400">
							Pitch accent data is unavailable for this card.
						</Text>
					</View>
				)}
			</View>
		);
	}

	return (
		<View className="rounded-2xl border border-white/8 bg-[#121315] px-5 py-4">
			<View className="flex-row items-start justify-between gap-3">
				<View className="min-w-0 flex-1">
					<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
						Back
					</Text>
				</View>
				{entryId ? (
					<TouchableOpacity
						activeOpacity={0.85}
						className="h-9 w-9 items-center justify-center rounded-xl border border-white/8 bg-[#17191c]"
						onPress={() =>
							router.push(
								getKnowledgeRoute(knowledgeId, {
									cardId: card.id,
									deckId: originDeckId ?? card.deckId,
									deckName: originDeckName ?? null,
									originPath,
								}),
							)
						}
					>
						<ArrowUpRight size={15} color="#E4E4E7" />
					</TouchableOpacity>
				) : null}
			</View>

			<View className="mt-3">
				<ReviewReadingDisplay
					front={card.knowledge.front}
					pronunciation={pronunciation}
					isJapanese={isJapaneseCard}
				/>
			</View>

			<ReviewBackContent
				card={card}
				className="mt-4"
				showPronunciation={false}
				showPitchAccent={showDeferredPitchAccent}
			/>
		</View>
	);
}, (prevProps, nextProps) =>
	prevProps.card.id === nextProps.card.id &&
	prevProps.originPath === nextProps.originPath &&
	prevProps.originDeckId === nextProps.originDeckId &&
	prevProps.originDeckName === nextProps.originDeckName,
);

export const ReviewBottomBar = ({
	isAnswerVisible,
	isSubmitting,
	onReveal,
	onRate,
	preview,
}: {
	isAnswerVisible: boolean;
	isSubmitting: boolean;
	onReveal: () => void;
	onRate: (rating: (typeof REVIEW_GRADES)[number]) => void;
	preview: KnowledgeReviewPreview | null;
}) => {
	const insets = useSafeAreaInsets();
	const [frozenPreview, setFrozenPreview] = useState<KnowledgeReviewPreview | null | undefined>(
		undefined,
	);

	useEffect(() => {
		if (!isAnswerVisible) {
			setFrozenPreview(undefined);
			return;
		}

		if (preview) {
			setFrozenPreview((current) => current ?? preview);
		}
	}, [isAnswerVisible, preview]);

	const visiblePreview = isAnswerVisible ? (frozenPreview ?? preview) : preview;
	const gradeOptions =
		visiblePreview?.grades ?? REVIEW_GRADES.map((rating) => ({ rating }));

	return (
		<View
			className="border-t border-white/8 bg-[#0F1012] px-3 pt-2.5"
			style={{
				paddingBottom: Math.max(insets.bottom, 8) + 4,
			}}
		>
			{isAnswerVisible ? (
				<View className="gap-1.5">
					<View className="flex-row gap-1.5">
						{gradeOptions.slice(0, 2).map((grade) => {
							const style = RATING_STYLES[grade.rating];
							const dueLabel =
								visiblePreview && "card" in grade
									? intervalLabelFromDates(
											(grade.card as { due: Date }).due,
											visiblePreview.now,
										)
									: null;

							return (
								<Button
									key={grade.rating}
									onPress={() => void onRate(grade.rating)}
									disabled={isSubmitting}
									className={cn(
										"h-14 min-w-0 flex-1 overflow-hidden rounded-lg border px-3 py-2.5",
										style.border,
										style.bg,
									)}
								>
									<View className="w-full flex-1 items-center justify-center">
										<Text
											className={cn("text-sm font-semibold", style.label)}
											numberOfLines={1}
										>
											{grade.rating}
										</Text>
										{dueLabel ? (
											<Text
												className={cn("text-[10px] leading-3 text-center", style.meta)}
												numberOfLines={1}
											>
												{dueLabel}
											</Text>
										) : (
											<View className="h-4" />
										)}
									</View>
								</Button>
							);
						})}
					</View>
					<View className="flex-row gap-1.5">
						{gradeOptions.slice(2).map((grade) => {
							const style = RATING_STYLES[grade.rating];
							const dueLabel =
								visiblePreview && "card" in grade
									? intervalLabelFromDates(
											(grade.card as { due: Date }).due,
											visiblePreview.now,
										)
									: null;

							return (
								<Button
									key={grade.rating}
									onPress={() => void onRate(grade.rating)}
									disabled={isSubmitting}
									className={cn(
										"h-14 min-w-0 flex-1 overflow-hidden rounded-lg border px-3 py-2.5",
										style.border,
										style.bg,
									)}
								>
									<View className="w-full flex-1 items-center justify-center">
										<Text
											className={cn("text-sm font-semibold", style.label)}
											numberOfLines={1}
										>
											{grade.rating}
										</Text>
										{dueLabel ? (
											<Text
												className={cn("text-[10px] leading-3 text-center", style.meta)}
												numberOfLines={1}
											>
												{dueLabel}
											</Text>
										) : (
											<View className="h-4" />
										)}
									</View>
								</Button>
							);
						})}
					</View>
				</View>
			) : (
				<Button
					onPress={onReveal}
					disabled={isSubmitting}
					className="h-11 rounded-xl border border-white/8 bg-[#17191c]"
				>
					<Text className="text-sm font-medium text-zinc-100">Reveal</Text>
				</Button>
			)}
		</View>
	);
};
