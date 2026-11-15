import { Router, useRouter } from "expo-router";
import {
	ActivityIndicator,
	View,
	TouchableOpacity,
} from "react-native";
import { Text } from "@/components/ui/text";
import { useMemo } from "react";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { Input } from "@/components/ui/input";
import pinyin_tone from "pinyin-tone";
import { LegendList } from "@legendapp/list";
import { EntrySearchResult } from "@/lib/database/lexicon";
import { useAppLanguage } from "@/lib/store/appLanguageStore";
import { useDictionarySearch } from "@/lib/store/dictionarySearchStore";
import { Search } from "lucide-react-native";

// Helper function to parse CL definitions
export const parseClassifierDefinition = (definitionLine: string) => {
	if (!definitionLine.startsWith("CL:")) {
		return null;
	}

	// Remove "CL:", trim whitespace, and handle empty strings after CL:
	const content = definitionLine.substring(3).trim();
	if (!content) {
		return null; // Return null if nothing follows "CL:"
	}

	const parts = content.split(",");
	const pinyinList: string[] = [];
	const simplifiedChars: string[] = [];
	const traditionalChars: (string | null)[] = []; // Can be null if same as simplified

	parts.forEach((part) => {
		const pinyinMatch = part.match(/\[(.*?)\]$/);
		let pinyin = "";
		if (pinyinMatch && pinyinMatch[1]) {
			pinyin = pinyinMatch[1];
		}

		// Remove pinyin like [ge4]
		const charsWithoutPinyin = part.replace(/\[.*?\]$/, "").trim();

		if (charsWithoutPinyin.length > 0) {
			let simplified: string;
			let traditional: string | null = null;

			// Handle trad|simp format
			if (charsWithoutPinyin.includes("|")) {
				const splitChars = charsWithoutPinyin.split("|");
				traditional = splitChars[0];
				simplified = splitChars[1];
			} else {
				simplified = charsWithoutPinyin;
				// If no '|' is present, traditional is the same as simplified
				traditional = simplified;
			}

			simplifiedChars.push(simplified);
			// Store traditional only if it's different from simplified
			traditionalChars.push(traditional !== simplified ? traditional : null);
			pinyinList.push(pinyin); // Add extracted pinyin
		}
	});

	// Return null if no valid parts were found
	return {
		simplified: simplifiedChars.length > 0 ? simplifiedChars : null,
		traditional: traditionalChars.length > 0 ? traditionalChars : null, // Array of traditional chars (or null)
		length: simplifiedChars.length, // Length is based on simplified chars
		pinyin: pinyinList, // Pinyin list corresponds to the characters array by index
	};
};

// TODO: look at this more closely, seems to be strange line spacing issues
// i.e., "art of war" search, bottom results
// Helper function to render a definition line with inline styled segments

// Define the type for the segments returned by parseDefinitionLine
export type DefinitionSegment =
	| { type: "text"; content: string }
	| {
			type: "styled";
			simplified: string;
			traditional: string | null;
			pinyin: string;
	  };

// Updated function to parse definition lines into structured segments
export const parseDefinitionLine = (
	definitionLine: string,
): DefinitionSegment[] => {
	const regex = /([\p{sc=Han}]+)(?:\|([\p{sc=Han}]+))?\[([^\]]+)\]/gu;
	const parts: DefinitionSegment[] = [];
	let lastIndex = 0;

	for (const match of definitionLine.matchAll(regex)) {
		const fullMatch = match[0];
		const firstHan = match[1];
		const secondHan = match[2]; // Undefined if no '|'
		const pinyin = match[3];
		const matchStartIndex = match.index!;

		// Add preceding text if any
		if (matchStartIndex > lastIndex) {
			parts.push({
				type: "text",
				content: definitionLine.substring(lastIndex, matchStartIndex),
			});
		}

		let simplified: string;
		let traditional: string | null = null;

		if (secondHan) {
			// trad|simp format
			traditional = firstHan;
			simplified = secondHan;
		} else {
			// simp[pinyin] format
			simplified = firstHan;
		}

		// Add the styled segment data
		parts.push({
			type: "styled",
			simplified,
			traditional: traditional !== simplified ? traditional : null, // Store only if different
			pinyin,
		});

		lastIndex = matchStartIndex + fullMatch.length;
	}

	// Add remaining text if any
	if (lastIndex < definitionLine.length) {
		parts.push({
			type: "text",
			content: definitionLine.substring(lastIndex),
		});
	}

	// If no matches were found, return the original line as a single text segment
	if (parts.length === 0) {
		return [{ type: "text", content: definitionLine }];
	}

	return parts;
};

// Define the new WordItem component
export const WordItem = ({
	item,
	onPress,
}: {
	item: EntrySearchResult;
	onPress: () => void;
}) => {
	const charRank = useMemo(() => {
		if (item.frequencyRank) {
			return roundNumber(item.frequencyRank);
		} else {
			return item.frequencyRank;
		}
	}, [item.frequencyRank]);

	const traditionalForm = useMemo(() => {
		return item.forms.find(
			(form) => form.script === "Hant" && form.text !== item.canonicalForm,
		)?.text;
	}, [item.forms, item.canonicalForm]);

	const formattedReading = useMemo(() => {
		if (!item.canonicalReading) return null;
		if (/^[a-z0-9\s:]+$/i.test(item.canonicalReading)) {
			return pinyin_tone(item.canonicalReading);
		}
		return item.canonicalReading;
	}, [item.canonicalReading]);

	const showMeta =
		!!item.hsk ||
		!!(item.frequencyRank && item.frequencyRank <= 30000);

	return (
		<TouchableOpacity onPress={onPress}>
			<View className="my-1 rounded-2xl border border-white/8 bg-[#121315] px-4 py-2.5">
				<View className="flex w-full flex-row items-start gap-3">
					<View className="min-w-0 flex-1">
						<View className="flex-row items-baseline gap-2 flex-wrap">
							<Text className="text-[22px] font-semibold leading-tight text-blue-100">
								{item.canonicalForm}
								{traditionalForm && traditionalForm !== item.canonicalForm && (
									<Text className="text-[22px] font-semibold text-red-100">
										{" "}
										({traditionalForm})
									</Text>
								)}
							</Text>
							{formattedReading && (
								<Text className="text-sm font-medium text-zinc-300">
									{formattedReading}
								</Text>
							)}
						</View>
						<Text
							numberOfLines={3}
							ellipsizeMode="tail"
							className="pt-2 text-[15px] leading-6 text-zinc-200"
						>
							{item.glossPreview
								.map((definitionLine: string, index: number) => {
							const classifierText = parseClassifierDefinition(definitionLine);

							if (classifierText) {
								// Render parsed classifier text in blue
									return (
										<Text key={`${item.id}-cl-${index}`}>
										<Text className="font-bold"> {index + 1} </Text>
										{classifierText.length > 0 && (
											<Text className="italic text-zinc-400">
												{classifierText.length === 1
													? "Measure Word: "
													: "Measure Words: "}
											</Text>
										)}
										{classifierText.simplified?.map((simpChar, cIndex) => {
											const tradChar = classifierText.traditional?.[cIndex];
											return (
												<Text key={`${item.id}-cl-${index}-${cIndex}`}>
													{cIndex > 0 && classifierText.length > 1 && ", "}
													<Text className="text-blue-100 font-bold">
														{simpChar}
														{tradChar && (
															<Text className="text-red-100">
																{" "}
																({tradChar})
															</Text>
														)}
													</Text>
													{classifierText.pinyin[cIndex] && (
														<Text className="text-sm font-semibold text-zinc-300">
															{" "}
															{pinyin_tone(
																classifierText.pinyin[cIndex].toLowerCase(),
															)}
														</Text>
													)}
												</Text>
											);
										})}
									</Text>
								);
							} else {
								// Handle regular definitions with potential inline segments
								const prefix = index === 0 ? "" : " ";
								// Parse the line into structured segments
								const definitionSegments = parseDefinitionLine(definitionLine);
									return (
										<Text key={`${item.id}-def-${index}`}>
										{prefix}
										<Text className="font-bold text-zinc-400">{index + 1} </Text>
										{/* Render segments based on their type */}
										{definitionSegments.map((segment, segmentIndex) => {
											if (segment.type === "text") {
												return (
													<Text
														key={`${item.id}-def-${index}-txt-${segmentIndex}`}
													>
														{segment.content}
													</Text>
												);
											} else {
												// segment.type === 'styled'
												return (
													<Text
														key={`${item.id}-def-${index}-styled-${segmentIndex}`}
													>
														<Text className="text-blue-100 font-bold">
															{segment.simplified}
															{segment.traditional && ( // Only show trad if present and different
																<Text className="text-red-100">
																	{" "}
																	({segment.traditional})
																</Text>
															)}
														</Text>
														{segment.pinyin && (
															<Text className="font-semibold text-zinc-300">
																{" "}
																{pinyin_tone(segment.pinyin.toLowerCase())}
															</Text>
														)}
													</Text>
												);
											}
										})}
									</Text>
								);
							}
								})}
						</Text>
					</View>
					{showMeta && (
						<View className="items-end gap-2">
							{item.hsk && (
								<View className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-1">
									<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">
										HSK {item.hsk}
									</Text>
								</View>
							)}
							{item.frequencyRank && item.frequencyRank <= 30000 && (
								<View className="rounded-full border border-white/8 bg-white/[0.04] px-2 py-1">
									<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">
										{charRank}
									</Text>
								</View>
							)}
						</View>
					)}
				</View>
			</View>
		</TouchableOpacity>
	);
};

export const roundNumber = (num: number) => {
	if (num >= 100) {
		// Round to nearest hundred
		return Math.ceil(num / 100) * 100;
	} else {
		// Round to nearest ten
		return Math.ceil(num / 10) * 10;
	}
};

// Function to render each item in the FlatList - updated
export const renderWordItem = ({
	item,
	router,
}: {
	item: EntrySearchResult;
	router: Router;
}) => {
	return (
		<WordItem
			item={item}
			onPress={() => router.push(`/character?entryId=${item.id}`)}
		/>
	);
};

export default function Index() {
	const router = useRouter();
	const db = useDrizzle();
	const { activeLanguageId, availableLanguages } = useAppLanguage();
	const {
		search,
		results,
		isSearching,
		trimmedSearch,
		trimmedDebouncedSearch,
		setSearch,
	} = useDictionarySearch({
		db,
		languageId: activeLanguageId,
	});
	const isSearchSettling = trimmedSearch !== trimmedDebouncedSearch;
	const activeLanguage = useMemo(
		() =>
			availableLanguages.find((language) => language.id === activeLanguageId) ??
			null,
		[activeLanguageId, availableLanguages],
	);
	const visibleWordsResult = isSearchSettling ? [] : results;
	const emptyStateText =
		trimmedSearch.length === 0
			? "Start typing to search"
			: "No results";

	return (
		<View className="flex-1 bg-[#0F1012] px-4 pt-3">
			<View className="mb-3 gap-2">
				<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
					Dictionary
				</Text>
				<View className="flex-row items-center rounded-2xl border border-white/8 bg-[#141518] px-3">
					<Search size={18} color="#71717A" />
					<Input
						value={search}
						onChangeText={setSearch}
						placeholder={`Search ${activeLanguage?.name ?? "language"} words`}
						className="flex-1 border-0 bg-transparent px-3 py-3 text-base text-zinc-100"
					/>
				</View>
				<Text className="text-sm text-zinc-500">
					{trimmedSearch.length === 0
						? `Search by word, reading, or gloss`
						: `${visibleWordsResult.length} result${visibleWordsResult.length === 1 ? "" : "s"}`}
				</Text>
			</View>
			{(isSearchSettling || isSearching) && trimmedSearch.length > 0 ? (
				<View className="pointer-events-none absolute right-7 top-[78px]">
					<ActivityIndicator size="small" color="#71717A" />
				</View>
			) : null}
			<LegendList
				data={visibleWordsResult}
				renderItem={({ item }) => renderWordItem({ item, router })}
				keyExtractor={(item) => item.id}
				ListEmptyComponent={
					<View className="items-center justify-center rounded-2xl border border-dashed border-white/8 bg-[#121315] px-4 py-10">
						<Text className="text-sm text-zinc-500">{emptyStateText}</Text>
					</View>
				}
				contentContainerStyle={{ paddingBottom: 24 }}
				estimatedItemSize={118}
				recycleItems
			/>
		</View>
	);
}
