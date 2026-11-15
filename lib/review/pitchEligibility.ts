import type { EntryDetailResult } from "@/lib/database/lexicon";

type PitchEligibleEntry = Pick<EntryDetailResult, "languageId" | "pitchAccents">;

export const hasPitchAccentReviewSupport = (
	entry: PitchEligibleEntry | null | undefined,
) => Boolean(entry && entry.languageId === "lang_ja" && entry.pitchAccents.length > 0);
