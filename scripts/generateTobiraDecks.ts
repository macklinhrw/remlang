import fs from "fs";
import path from "path";
import { z } from "zod";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { getEntryDetail, searchEntries } from "@/lib/database/lexicon";
import {
	parseTobiraCountingLessonFromPath,
	parseTobiraLessonFromPath,
	parseTobiraVocabTsv,
	resolvePremadeFront,
	splitSlashVariants,
} from "@/lib/premadeDecks/tobira";
import type {
	PremadeDeckFile,
	PremadeDeckItem,
	PremadeDictionaryLink,
} from "@/lib/premadeDecks/types";
import {
	getPremadeBookLabel,
	PREMADE_DECK_BOOKS,
	type PremadeDeckBook,
} from "@/lib/premadeDecks/types";
import { openSeedDatabase } from "@/scripts/seed/core/db";

const loadLocalEnv = () => {
	for (const fileName of [".env", ".env.local"]) {
		const envPath = path.join(process.cwd(), fileName);
		if (!fs.existsSync(envPath)) {
			continue;
		}

		const contents = fs.readFileSync(envPath, "utf-8");
		for (const rawLine of contents.split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) {
				continue;
			}

			const separatorIndex = line.indexOf("=");
			if (separatorIndex <= 0) {
				continue;
			}

			const key = line.slice(0, separatorIndex).trim();
			if (!key || process.env[key] !== undefined) {
				continue;
			}

			let value = line.slice(separatorIndex + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}

			process.env[key] = value;
		}
	}
};

loadLocalEnv();

const SOURCE_ROOT = "/path/to/tobira-vocab";
const OUTPUT_ROOT = path.join(process.cwd(), "assets/decklists");
const STATUS_FILE_PATH = path.join(OUTPUT_ROOT, "tobira-import-status.json");
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL =
	process.env.OPENROUTER_MODEL?.trim() || "google/gemini-3-flash-preview";
const MAX_CANDIDATES = 8;
const FILE_FILTER = process.env.TOBIRA_FILE_FILTER?.trim() || null;
const OPENROUTER_MAX_MATCHES = Number(process.env.OPENROUTER_MAX_MATCHES ?? "0");
const OPENROUTER_CONCURRENCY = Math.max(1, Number(process.env.OPENROUTER_CONCURRENCY ?? "8"));
const FORCE_REMATCH = process.env.FORCE_REMATCH === "1";

const llmSelectionSchema = z.object({
	selectedEntryId: z.string().nullable(),
	selectedSenseIds: z.array(z.string()),
	usesAllSenses: z.boolean(),
	confidence: z.enum(["exact", "strong", "weak", "none"]),
	reason: z.string(),
});

type CandidateEntry = Awaited<ReturnType<typeof getEntryDetail>>;

type RankedCandidate = NonNullable<CandidateEntry> & {
	localScore: number;
	matchSummary: {
		formMatches: string[];
		readingMatches: string[];
		exactPairMatch: boolean;
	};
};

type GenerationStats = {
	totalRows: number;
	exactLinkedRows: number;
	allSensesLinkedRows: number;
	unlinkedRows: number;
	ambiguousRows: number;
	failedRows: number;
	openRouterFailures: number;
	validationFailures: number;
};

type ImportRowStatus =
	| "pending"
	| "matched_exact"
	| "matched_all_senses"
	| "unlinked"
	| "failed";

type PersistedStatusRow = {
	id: string;
	book: PremadeDeckBook;
	lesson: number;
	sourcePath: string;
	status: ImportRowStatus;
	updatedAt: string;
	attemptCount: number;
	lastError: string | null;
	dictionaryLink: PremadeDictionaryLink | null;
};

type PersistedStatusFile = {
	version: 1;
	updatedAt: string;
	llmCursorId: string | null;
	rows: Record<string, PersistedStatusRow>;
};

type SourceRowContext = {
	id: string;
	book: PremadeDeckBook;
	lesson: number;
	sourcePath: string;
	item: PremadeDeckItem;
};

type PendingLlmTask = {
	row: SourceRowContext;
	candidates: RankedCandidate[];
	fallbackLink: PremadeDictionaryLink | null;
};

const normalizeLookupText = (value: string | null | undefined) =>
	value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";

const listTobiraVocabFiles = () =>
	fs
		.readdirSync(SOURCE_ROOT, { recursive: true })
		.map((entry) => path.join(SOURCE_ROOT, String(entry)))
		.filter((entry) => entry.endsWith("-vocab.tsv"))
		.filter((entry) => !/counting|grammar|conjugation|extended_numbers|kanji-highlighted/i.test(entry))
		.filter((entry) => (FILE_FILTER ? entry.includes(FILE_FILTER) : true))
		.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const listTobiraCountingFiles = () =>
	fs
		.readdirSync(SOURCE_ROOT, { recursive: true })
		.map((entry) => path.join(SOURCE_ROOT, String(entry)))
		.filter((entry) => /-counting_vocab\.tsv$/i.test(entry))
		.filter((entry) => (FILE_FILTER ? entry.includes(FILE_FILTER) : true))
		.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const getLessonDeckFilePath = (book: PremadeDeckBook, lesson: number) =>
	path.join(OUTPUT_ROOT, book, `L${lesson}-decklist.json`);

const getLessonKey = (book: PremadeDeckBook, lesson: number) => `${book}:L${lesson}`;

const getFieldVariants = (value: string | null | undefined) =>
	[...new Set(splitSlashVariants(value).map((item) => normalizeLookupText(item)).filter(Boolean))];

const toMatchSummary = ({
	entry,
	formVariants,
	readingVariants,
}: {
	entry: NonNullable<CandidateEntry>;
	formVariants: string[];
	readingVariants: string[];
}) => {
	const formValues = new Set(
		[entry.canonicalForm, ...entry.forms.map((form) => form.text)].map((value) =>
			normalizeLookupText(value),
		),
	);
	const readingValues = new Set(
		[entry.canonicalReading, ...entry.readings.map((reading) => reading.text)].map((value) =>
			normalizeLookupText(value),
		),
	);
	const matchedForms = formVariants.filter((variant) => formValues.has(variant));
	const matchedReadings = readingVariants.filter((variant) => readingValues.has(variant));

	return {
		formMatches: matchedForms,
		readingMatches: matchedReadings,
		exactPairMatch: matchedForms.length > 0 && matchedReadings.length > 0,
	};
};

const getCandidateLocalScore = (candidate: RankedCandidate) => {
	let score = candidate.localScore;

	if (candidate.matchSummary.exactPairMatch) score += 1200;
	if (candidate.matchSummary.formMatches.length > 0) score += 320;
	if (candidate.matchSummary.readingMatches.length > 0) score += 220;
	if (candidate.jaData?.isCommon) score += 50;
	if (candidate.jaData?.frequencyRank) {
		score += Math.max(0, 50 - Math.min(50, Math.floor(candidate.jaData.frequencyRank / 500)));
	}

	return score;
};

const rankCandidates = async ({
	db,
	kanaVariants,
	kanjiVariants,
}: {
	db: DrizzleInstance;
	kanaVariants: string[];
	kanjiVariants: string[];
}) => {
	const queries = [...new Set([...kanjiVariants, ...kanaVariants])];
	const candidateSignals = new Map<string, number>();

	for (const query of queries) {
		const results = await searchEntries(db, query, { languageId: "lang_ja" });
		for (const [index, result] of results.slice(0, 25).entries()) {
			const existing = candidateSignals.get(result.id) ?? 0;
			candidateSignals.set(result.id, Math.max(existing, 200 - index * 5));
		}
	}

	const detailedCandidates = await Promise.all(
		[...candidateSignals.entries()]
			.sort((left, right) => right[1] - left[1])
			.slice(0, 16)
			.map(async ([entryId, localScore]) => {
				const entry = await getEntryDetail(db, entryId);
				if (!entry) return null;
				const matchSummary = toMatchSummary({
					entry,
					formVariants: kanjiVariants,
					readingVariants: kanaVariants,
				});

				return {
					...entry,
					localScore,
					matchSummary,
				} satisfies RankedCandidate;
			}),
	);

	return detailedCandidates
		.filter((candidate): candidate is RankedCandidate => candidate !== null)
		.sort((left, right) => getCandidateLocalScore(right) - getCandidateLocalScore(left))
		.slice(0, MAX_CANDIDATES);
};

const buildFallbackDictionaryLink = (
	candidates: RankedCandidate[],
): PremadeDictionaryLink | null => {
	const topCandidate = candidates[0];
	if (!topCandidate || !topCandidate.matchSummary.exactPairMatch) {
		return null;
	}

	const secondCandidate = candidates[1];
	if (
		secondCandidate &&
		secondCandidate.matchSummary.exactPairMatch &&
		getCandidateLocalScore(topCandidate) - getCandidateLocalScore(secondCandidate) < 200
	) {
		return null;
	}

	return {
		entryId: topCandidate.id,
		senseIds: [],
		usesAllSenses: true,
		matchStatus: "linked_local_all_senses",
		matchMethod: "deterministic_exact_match",
	};
};

const buildCandidatePromptPayload = (candidates: RankedCandidate[]) =>
	candidates.map((candidate) => ({
		id: candidate.id,
		canonicalForm: candidate.canonicalForm,
		canonicalReading: candidate.canonicalReading,
		forms: candidate.forms.slice(0, 6).map((form) => form.text),
		readings: candidate.readings.slice(0, 6).map((reading) => reading.text),
		matchSummary: candidate.matchSummary,
		senses: candidate.senses.map((sense) => ({
			id: sense.id,
			partOfSpeech: sense.partOfSpeech,
			glosses: sense.glosses
				.filter((gloss) => gloss.glossLanguage === "eng")
				.map((gloss) => gloss.text),
		})),
	}));

const extractStructuredContent = (payload: unknown) => {
	if (!payload || typeof payload !== "object") return null;
	const response = payload as {
		choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
	};
	const content = response.choices?.[0]?.message?.content;

	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("");
	}

	return null;
};

const matchWithOpenRouter = async ({
	item,
	candidates,
	apiKey,
}: {
	item: PremadeDeckItem;
	candidates: RankedCandidate[];
	apiKey: string;
}) => {
	const response = await fetch(OPENROUTER_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: OPENROUTER_MODEL,
			temperature: 0,
			messages: [
				{
					role: "system",
					content:
						"You are matching a Japanese textbook vocab row to a local dictionary candidate list. Choose only from the provided candidate IDs and sense IDs. If the entry choice is uncertain, return null. If the entry is trusted but exact senses are uncertain, return usesAllSenses=true with no selectedSenseIds.",
				},
				{
					role: "user",
					content: JSON.stringify({
						textbookRow: {
							kana: item.kana,
							kanji: item.kanji,
							english: item.english,
							sourceTag: item.sourceTag,
						},
						candidates: buildCandidatePromptPayload(candidates),
					}),
				},
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					name: "tobira_dictionary_match",
					strict: true,
					schema: {
						type: "object",
						additionalProperties: false,
						properties: {
							selectedEntryId: {
								type: ["string", "null"],
							},
							selectedSenseIds: {
								type: "array",
								items: { type: "string" },
							},
							usesAllSenses: {
								type: "boolean",
							},
							confidence: {
								type: "string",
								enum: ["exact", "strong", "weak", "none"],
							},
							reason: {
								type: "string",
							},
						},
						required: [
							"selectedEntryId",
							"selectedSenseIds",
							"usesAllSenses",
							"confidence",
							"reason",
						],
					},
				},
			},
		}),
	});

	if (!response.ok) {
		throw new Error(`OpenRouter request failed with ${response.status}`);
	}

	const json = await response.json();
	const content = extractStructuredContent(json);
	if (!content) {
		throw new Error("OpenRouter returned no structured content.");
	}

	return llmSelectionSchema.parse(JSON.parse(content));
};

const buildLlmDictionaryLink = ({
	selection,
	candidates,
}: {
	selection: z.infer<typeof llmSelectionSchema>;
	candidates: RankedCandidate[];
}): PremadeDictionaryLink | null => {
	if (!selection.selectedEntryId || selection.confidence === "none") {
		return null;
	}

	const entry = candidates.find((candidate) => candidate.id === selection.selectedEntryId);
	if (!entry) {
		return null;
	}

	const validSenseIds = new Set(entry.senses.map((sense) => sense.id));
	const selectedSenseIds = selection.selectedSenseIds.filter((senseId) => validSenseIds.has(senseId));

	if (!selection.usesAllSenses && selectedSenseIds.length === 0) {
		return null;
	}

	return {
		entryId: entry.id,
		senseIds: selection.usesAllSenses ? [] : selectedSenseIds,
		usesAllSenses: selection.usesAllSenses || selectedSenseIds.length === 0,
		matchStatus: selection.usesAllSenses ? "linked_all_senses" : "linked_exact",
		matchMethod: "llm_candidate_selection",
	};
};

const buildDeckItem = ({
	book,
	lesson,
	index,
	row,
}: {
	book: PremadeDeckBook;
	lesson: number;
	index: number;
	row: ReturnType<typeof parseTobiraVocabTsv>[number];
}): PremadeDeckItem => ({
	id: `${book}-l${lesson}-${String(index + 1).padStart(4, "0")}`,
	sourceTag: row.sourceTag,
	kana: row.kana,
	kanji: row.kanji,
	english: row.english,
	front: resolvePremadeFront({ kana: row.kana, kanji: row.kanji }),
	pronunciation: row.kana,
	sourceDefinitions: row.english,
	dictionaryLink: null,
});

const deriveStatusFromDictionaryLink = (
	dictionaryLink: PremadeDictionaryLink | null,
): ImportRowStatus => {
	if (!dictionaryLink) return "unlinked";
	return dictionaryLink.usesAllSenses ? "matched_all_senses" : "matched_exact";
};

const isTerminalStatus = (status: ImportRowStatus) =>
	status === "matched_exact" || status === "matched_all_senses" || status === "unlinked";

const loadStatusFile = (): PersistedStatusFile | null => {
	if (!fs.existsSync(STATUS_FILE_PATH)) {
		return null;
	}

	try {
		return JSON.parse(fs.readFileSync(STATUS_FILE_PATH, "utf-8")) as PersistedStatusFile;
	} catch {
		return null;
	}
};

const seedStatusFromExistingDecklists = () => {
	const seeded = new Map<string, PersistedStatusRow>();

	for (const book of PREMADE_DECK_BOOKS) {
		const directory = path.join(OUTPUT_ROOT, book);
		if (!fs.existsSync(directory)) {
			continue;
		}

		for (const fileName of fs.readdirSync(directory).filter((entry) => entry.endsWith(".json"))) {
			const fullPath = path.join(directory, fileName);
			const parsed = JSON.parse(fs.readFileSync(fullPath, "utf-8")) as PremadeDeckFile;
			for (const item of parsed.list) {
				seeded.set(item.id, {
					id: item.id,
					book,
					lesson: parsed.deck.lesson,
					sourcePath: fullPath,
					status: deriveStatusFromDictionaryLink(item.dictionaryLink),
					updatedAt: new Date().toISOString(),
					attemptCount: 0,
					lastError: null,
					dictionaryLink: item.dictionaryLink,
				});
			}
		}
	}

	return seeded;
};

const persistStatusFile = (rows: Map<string, PersistedStatusRow>, llmCursorId: string | null) => {
	fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
	const payload: PersistedStatusFile = {
		version: 1,
		updatedAt: new Date().toISOString(),
		llmCursorId,
		rows: Object.fromEntries([...rows.entries()].sort(([left], [right]) => left.localeCompare(right))),
	};
	fs.writeFileSync(STATUS_FILE_PATH, JSON.stringify(payload, null, 2));
};

const buildSourceContexts = () => {
	const rows: SourceRowContext[] = [];

	for (const filePath of listTobiraVocabFiles()) {
		const lessonMeta = parseTobiraLessonFromPath(filePath);
		if (!lessonMeta) continue;

		const contents = fs.readFileSync(filePath, "utf-8");
		const parsedRows = parseTobiraVocabTsv(contents);

		for (const [index, row] of parsedRows.entries()) {
			const item = buildDeckItem({
				book: lessonMeta.book,
				lesson: lessonMeta.lesson,
				index,
				row,
			});

			rows.push({
				id: item.id,
				book: lessonMeta.book,
				lesson: lessonMeta.lesson,
				sourcePath: filePath,
				item,
			});
		}
	}

	for (const filePath of listTobiraCountingFiles()) {
		const lessonMeta = parseTobiraCountingLessonFromPath(filePath);
		if (!lessonMeta) continue;

		const contents = fs.readFileSync(filePath, "utf-8");
		const parsedRows = parseTobiraVocabTsv(contents);

		for (const [index, row] of parsedRows.entries()) {
			const item = buildDeckItem({
				book: lessonMeta.book,
				lesson: lessonMeta.lesson,
				index,
				row,
			});

			rows.push({
				id: item.id,
				book: lessonMeta.book,
				lesson: lessonMeta.lesson,
				sourcePath: filePath,
				item,
			});
		}
	}

	return rows;
};

const createInitialStatusRows = ({
	sourceRows,
	statusFile,
}: {
	sourceRows: SourceRowContext[];
	statusFile: PersistedStatusFile | null;
}) => {
	const seededDecklists = seedStatusFromExistingDecklists();
	const rows = new Map<string, PersistedStatusRow>(
		Object.entries(statusFile?.rows ?? {}),
	);

	for (const sourceRow of sourceRows) {
		const fromStatusFile = statusFile?.rows[sourceRow.id] ?? null;
		const seededRow = fromStatusFile ?? seededDecklists.get(sourceRow.id) ?? null;

		rows.set(
			sourceRow.id,
			seededRow
				? {
						...seededRow,
						book: sourceRow.book,
						lesson: sourceRow.lesson,
						sourcePath: sourceRow.sourcePath,
					}
				: {
				id: sourceRow.id,
				book: sourceRow.book,
				lesson: sourceRow.lesson,
				sourcePath: sourceRow.sourcePath,
				status: "pending",
				updatedAt: new Date().toISOString(),
				attemptCount: 0,
				lastError: null,
				dictionaryLink: null,
			},
		);
	}

	return rows;
};

const resetRowsAfterCursor = ({
	sourceRows,
	statusRows,
	llmCursorId,
}: {
	sourceRows: SourceRowContext[];
	statusRows: Map<string, PersistedStatusRow>;
	llmCursorId: string | null;
}) => {
	if (!llmCursorId) {
		return;
	}

	const cursorIndex = sourceRows.findIndex((row) => row.id === llmCursorId);
	if (cursorIndex < 0) {
		return;
	}

	for (const row of sourceRows.slice(cursorIndex + 1)) {
		const current = statusRows.get(row.id);
		statusRows.set(row.id, {
			id: row.id,
			book: row.book,
			lesson: row.lesson,
			sourcePath: row.sourcePath,
			status: "pending",
			updatedAt: new Date().toISOString(),
			attemptCount: current?.attemptCount ?? 0,
			lastError: null,
			dictionaryLink: null,
		});
	}
};

const writeLessonDeckFromStatus = ({
	book,
	lesson,
	rowsByLesson,
	statusRows,
}: {
	book: PremadeDeckBook;
	lesson: number;
	rowsByLesson: Map<string, SourceRowContext[]>;
	statusRows: Map<string, PersistedStatusRow>;
}) => {
	const lessonRows = rowsByLesson.get(getLessonKey(book, lesson)) ?? [];
	const deck: PremadeDeckFile = {
		deck: {
			id: `${book}-l${lesson}`,
			book,
			lesson,
			name: `${getPremadeBookLabel(book)} · Lesson ${lesson}`,
			languageId: "lang_ja",
			source: "tobira",
		},
		list: lessonRows.map((row) => ({
			...row.item,
			dictionaryLink: statusRows.get(row.id)?.dictionaryLink ?? null,
		})),
	};

	const outputPath = getLessonDeckFilePath(book, lesson);
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, JSON.stringify(deck, null, 2));
};

const writeAllDecksFromStatus = ({
	rowsByLesson,
	statusRows,
}: {
	rowsByLesson: Map<string, SourceRowContext[]>;
	statusRows: Map<string, PersistedStatusRow>;
}) => {
	for (const lessonRows of rowsByLesson.values()) {
		const firstRow = lessonRows[0];
		if (!firstRow) continue;
		writeLessonDeckFromStatus({
			book: firstRow.book,
			lesson: firstRow.lesson,
			rowsByLesson,
			statusRows,
		});
	}
};

const createEmptyStats = (): GenerationStats => ({
	totalRows: 0,
	exactLinkedRows: 0,
	allSensesLinkedRows: 0,
	unlinkedRows: 0,
	ambiguousRows: 0,
	failedRows: 0,
	openRouterFailures: 0,
	validationFailures: 0,
});

const getOverallStats = ({
	statusRows,
	scopeIds,
}: {
	statusRows: Map<string, PersistedStatusRow>;
	scopeIds: Set<string>;
}) => {
	const stats = createEmptyStats();
	stats.totalRows = scopeIds.size;

	for (const id of scopeIds) {
		const row = statusRows.get(id);
		if (!row) {
			continue;
		}
		switch (row.status) {
			case "matched_exact":
				stats.exactLinkedRows += 1;
				break;
			case "matched_all_senses":
				stats.allSensesLinkedRows += 1;
				break;
			case "unlinked":
				stats.unlinkedRows += 1;
				break;
			case "failed":
				stats.failedRows += 1;
				break;
			default:
				break;
		}
	}

	return stats;
};

const formatProgressLine = ({
	statusRows,
	scopeIds,
	llmCursorId,
	activeWorkers,
	llmCompleted,
	llmTotal,
	ambiguousRows,
	openRouterFailures,
	validationFailures,
}: {
	statusRows: Map<string, PersistedStatusRow>;
	scopeIds: Set<string>;
	llmCursorId: string | null;
	activeWorkers: number;
	llmCompleted: number;
	llmTotal: number;
	ambiguousRows: number;
	openRouterFailures: number;
	validationFailures: number;
}) => {
	const stats = getOverallStats({ statusRows, scopeIds });
	const completed =
		stats.exactLinkedRows +
		stats.allSensesLinkedRows +
		stats.unlinkedRows +
		stats.failedRows;
	const pending = Math.max(0, stats.totalRows - completed);
	const percent =
		stats.totalRows > 0 ? Math.floor((completed / stats.totalRows) * 100) : 100;

	return [
		`overall ${completed}/${stats.totalRows} ${percent}%`,
		`pending ${pending}`,
		`exact ${stats.exactLinkedRows}`,
		`all-senses ${stats.allSensesLinkedRows}`,
		`unlinked ${stats.unlinkedRows}`,
		`failed ${stats.failedRows}`,
		`ambiguous ${ambiguousRows}`,
		`llm ${llmCompleted}/${llmTotal}`,
		`workers ${activeWorkers}/${OPENROUTER_CONCURRENCY}`,
		`cursor ${llmCursorId ?? "-"}`,
		`api-fail ${openRouterFailures}`,
		`schema-fail ${validationFailures}`,
	].join(" | ");
};

const main = async () => {
	const { db, sqlite } = openSeedDatabase();
	const apiKey = process.env.OPENROUTER_API_KEY?.trim() || null;
	const sourceRows = buildSourceContexts();
	const existingStatusFile = loadStatusFile();
	const statusRows = createInitialStatusRows({
		sourceRows,
		statusFile: existingStatusFile,
	});
	const scopeIds = new Set(sourceRows.map((row) => row.id));
	let llmCursorId = FORCE_REMATCH ? null : existingStatusFile?.llmCursorId ?? null;
	const rowsByLesson = new Map<string, SourceRowContext[]>();

	for (const row of sourceRows) {
		const lessonKey = getLessonKey(row.book, row.lesson);
		const current = rowsByLesson.get(lessonKey) ?? [];
		current.push(row);
		rowsByLesson.set(lessonKey, current);
	}

	if (FORCE_REMATCH) {
		for (const row of sourceRows) {
			statusRows.set(row.id, {
				id: row.id,
				book: row.book,
				lesson: row.lesson,
				sourcePath: row.sourcePath,
				status: "pending",
				updatedAt: new Date().toISOString(),
				attemptCount: statusRows.get(row.id)?.attemptCount ?? 0,
				lastError: null,
				dictionaryLink: null,
			});
		}
	} else {
		resetRowsAfterCursor({
			sourceRows,
			statusRows,
			llmCursorId,
		});
	}

	writeAllDecksFromStatus({
		rowsByLesson,
		statusRows,
	});
	persistStatusFile(statusRows, llmCursorId);

	let ambiguousRows = 0;
	let openRouterFailures = 0;
	let validationFailures = 0;
	let llmCompleted = 0;
	let llmAttempted = 0;
	let activeWorkers = 0;
	let lastProgressLogAt = 0;
	let lastProgressLine = "";

	const renderProgress = (force = false) => {
		const line = formatProgressLine({
			statusRows,
			scopeIds,
			llmCursorId,
			activeWorkers,
			llmCompleted,
			llmTotal: llmAttempted,
			ambiguousRows,
			openRouterFailures,
			validationFailures,
		});

		if (process.stdout.isTTY) {
			process.stdout.write(`\r${line.padEnd(160)}`);
		} else {
			const now = Date.now();
			if ((force || now - lastProgressLogAt >= 1000) && line !== lastProgressLine) {
				lastProgressLogAt = now;
				lastProgressLine = line;
				console.log(line);
			}
		}
	};

	const updateRowStatus = ({
		row,
		status,
		dictionaryLink,
		lastError,
		incrementAttempt = false,
	}: {
		row: SourceRowContext;
		status: ImportRowStatus;
		dictionaryLink: PremadeDictionaryLink | null;
		lastError: string | null;
		incrementAttempt?: boolean;
	}) => {
		const current = statusRows.get(row.id);
		const nextRow: PersistedStatusRow = {
			id: row.id,
			book: row.book,
			lesson: row.lesson,
			sourcePath: row.sourcePath,
			status,
			updatedAt: new Date().toISOString(),
			attemptCount: (current?.attemptCount ?? 0) + (incrementAttempt ? 1 : 0),
			lastError,
			dictionaryLink,
		};
		statusRows.set(row.id, nextRow);
		persistStatusFile(statusRows, llmCursorId);
		writeLessonDeckFromStatus({
			book: row.book,
			lesson: row.lesson,
			rowsByLesson,
			statusRows,
		});
		renderProgress(true);
	};

	try {
		const drizzleDb = db as unknown as DrizzleInstance;
		const llmTasks: PendingLlmTask[] = [];
		const llmTaskOrder: string[] = [];
		const completedLlmTaskIds = new Set<string>();
		let contiguousLlmCursorIndex = -1;

		for (const row of sourceRows) {
			const currentStatus = statusRows.get(row.id);
			if (!FORCE_REMATCH && currentStatus && isTerminalStatus(currentStatus.status)) {
				continue;
			}

			const kanaVariants = getFieldVariants(row.item.kana);
			const kanjiVariants = getFieldVariants(row.item.kanji);
			const candidates = await rankCandidates({
				db: drizzleDb,
				kanaVariants,
				kanjiVariants,
			});

			const fallbackLink = buildFallbackDictionaryLink(candidates);
			if (candidates.length > 1 && fallbackLink === null) {
				ambiguousRows += 1;
			}

			const canUseLlm =
				Boolean(apiKey) &&
				candidates.length > 0 &&
				(OPENROUTER_MAX_MATCHES <= 0 || llmAttempted < OPENROUTER_MAX_MATCHES);

			if (canUseLlm) {
				llmTasks.push({
					row,
					candidates,
					fallbackLink,
				});
				llmTaskOrder.push(row.id);
				llmAttempted += 1;
				continue;
			}

			updateRowStatus({
				row,
				status: deriveStatusFromDictionaryLink(fallbackLink),
				dictionaryLink: fallbackLink,
				lastError: null,
			});
		}

		renderProgress();

		let taskIndex = 0;
		const worker = async () => {
			while (taskIndex < llmTasks.length) {
				const task = llmTasks[taskIndex++];
				if (!task) {
					return;
				}

				activeWorkers += 1;
				renderProgress();

				try {
					const selection = await matchWithOpenRouter({
						item: task.row.item,
						candidates: task.candidates,
						apiKey: apiKey!,
					});
					const llmLink = buildLlmDictionaryLink({
						selection,
						candidates: task.candidates,
					});
					const resolvedLink = llmLink ?? task.fallbackLink;

					updateRowStatus({
						row: task.row,
						status: deriveStatusFromDictionaryLink(resolvedLink),
						dictionaryLink: resolvedLink,
						lastError: null,
						incrementAttempt: true,
					});
					completedLlmTaskIds.add(task.row.id);
					while (
						contiguousLlmCursorIndex + 1 < llmTaskOrder.length &&
						completedLlmTaskIds.has(llmTaskOrder[contiguousLlmCursorIndex + 1]!)
					) {
						contiguousLlmCursorIndex += 1;
						llmCursorId = llmTaskOrder[contiguousLlmCursorIndex] ?? llmCursorId;
					}
					persistStatusFile(statusRows, llmCursorId);
				} catch (error) {
					if (error instanceof z.ZodError) {
						validationFailures += 1;
					} else {
						openRouterFailures += 1;
					}

					updateRowStatus({
						row: task.row,
						status: "failed",
						dictionaryLink: task.fallbackLink,
						lastError: error instanceof Error ? error.message : "Unknown LLM error.",
						incrementAttempt: true,
					});
				} finally {
					llmCompleted += 1;
					activeWorkers = Math.max(0, activeWorkers - 1);
					renderProgress();
				}
			}
		};

		await Promise.all(
			Array.from({ length: Math.min(OPENROUTER_CONCURRENCY, Math.max(1, llmTasks.length)) }, () =>
				worker(),
			),
		);

		writeAllDecksFromStatus({
			rowsByLesson,
			statusRows,
		});
		persistStatusFile(statusRows, llmCursorId);

		if (process.stdout.isTTY) {
			process.stdout.write("\n");
		} else {
			renderProgress(true);
		}

		const finalStats = getOverallStats({ statusRows, scopeIds });
		finalStats.ambiguousRows = ambiguousRows;
		finalStats.openRouterFailures = openRouterFailures;
		finalStats.validationFailures = validationFailures;
		console.log(JSON.stringify(finalStats, null, 2));
	} finally {
		sqlite.close();
	}
};

void main();
