import type { EntryDetailResult } from "@/lib/database/lexicon";

type EntryPitchAccent = EntryDetailResult["pitchAccents"][number];
type PitchAccentLevel = "high" | "low";

export type KnowledgePitchAccentOverride = {
  primaryPitchAccentDictionaryId?: string | null;
  primaryPitchAccentReading?: string | null;
  primaryPitchAccentAccentNumber?: number | null;
  primaryPitchAccentIsCustom?: boolean | null;
};

export type NormalizedKnowledgePitchAccentOverride = {
  primaryPitchAccentDictionaryId: string | null;
  primaryPitchAccentReading: string | null;
  primaryPitchAccentAccentNumber: number | null;
  primaryPitchAccentIsCustom: boolean | null;
};

export type ResolvedKnowledgePitchAccent =
  | {
      mode: "default";
      primary: EntryPitchAccent;
      primaryReading: string;
      primaryAccentNumber: number;
      variants: EntryPitchAccent[];
    }
  | {
      mode: "variant";
      primary: EntryPitchAccent;
      primaryReading: string;
      primaryAccentNumber: number;
      variants: EntryPitchAccent[];
    }
  | {
      mode: "custom";
      primary: null;
      primaryReading: string;
      primaryAccentNumber: number;
      variants: EntryPitchAccent[];
    }
  | null;

type PitchAccentSortOptions = {
  preferredReading?: string | null;
};

const KANA_READING_PATTERN = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・]+$/u;

const getSourcePriority = (dictionaryId: string | null) => {
  switch (dictionaryId) {
    case "dict_unidic_cwj":
      return 0;
    case "dict_kanjium_pitch":
      return 1;
    default:
      return 2;
  }
};

const normalizeText = (value: string | null | undefined) => {
  const normalized = value?.normalize("NFKC").trim();
  return normalized ? normalized : null;
};

export const normalizePitchAccentReading = (value: string | null | undefined) =>
  normalizeText(value);

export const getPitchAccentDisplayReading = (pitchAccent: EntryPitchAccent) =>
  normalizePitchAccentReading(pitchAccent.pronunciation ?? pitchAccent.reading) ?? "";

export const getPitchAccentVariantKey = (pitchAccent: EntryPitchAccent) => {
  const displayReading = getPitchAccentDisplayReading(pitchAccent);
  const accentPattern = (pitchAccent.accentPattern ?? "").normalize("NFKC").trim();
  return `${displayReading}::${pitchAccent.accentNumber}::${accentPattern}`;
};

const getPitchAccentReadingPriority = (
  pitchAccent: EntryPitchAccent,
  preferredReading: string | null,
) => {
  if (!preferredReading) return 1;

  const displayReading = getPitchAccentDisplayReading(pitchAccent);
  if (displayReading === preferredReading) return 0;

  return normalizePitchAccentReading(pitchAccent.reading) === preferredReading ? 0 : 1;
};

const getUnidicSourcePosPriority = (pitchAccent: EntryPitchAccent) => {
  if (pitchAccent.dictionaryId !== "dict_unidic_cwj") return 0;

  switch (pitchAccent.sourcePosClass) {
    case "numeral":
    case "counter":
    case "noun-general":
    case "noun-proper":
    case "pronoun":
      return 0;
    case "verb":
    case "adjective":
    case "adverb":
    case "interjection":
      return 1;
    case "other":
      return 2;
    case "suffix-prefix-auxiliary":
      return 3;
    default:
      return 2;
  }
};

export const getSortedPitchAccents = (
  pitchAccents: EntryPitchAccent[],
  options?: PitchAccentSortOptions,
) => {
  const preferredReading = normalizePitchAccentReading(options?.preferredReading);
  const sortedPitchAccents = [...pitchAccents]
    .sort((left, right) => {
      const sourcePriorityDelta =
        getSourcePriority(left.dictionaryId) - getSourcePriority(right.dictionaryId);
      if (sourcePriorityDelta !== 0) return sourcePriorityDelta;

      const readingPriorityDelta =
        getPitchAccentReadingPriority(left, preferredReading) -
        getPitchAccentReadingPriority(right, preferredReading);
      if (readingPriorityDelta !== 0) return readingPriorityDelta;

      const sourcePosPriorityDelta =
        getUnidicSourcePosPriority(left) - getUnidicSourcePosPriority(right);
      if (sourcePosPriorityDelta !== 0) return sourcePosPriorityDelta;

      const accentOrderDelta = left.accentOrder - right.accentOrder;
      if (accentOrderDelta !== 0) return accentOrderDelta;

      return left.accentNumber - right.accentNumber;
    })
    .filter((pitchAccent, index, sorted) => {
      const key = getPitchAccentVariantKey(pitchAccent);
      return sorted.findIndex((candidate) => getPitchAccentVariantKey(candidate) === key) === index;
    });

  return sortedPitchAccents;
};

export const getPrimaryPitchAccent = (
  pitchAccents: EntryPitchAccent[],
  preferredReading?: string | null,
) => getSortedPitchAccents(pitchAccents, { preferredReading })[0] ?? null;

export const normalizeKnowledgePitchAccentOverride = (
  override?: KnowledgePitchAccentOverride | null,
): NormalizedKnowledgePitchAccentOverride => ({
  primaryPitchAccentDictionaryId: normalizeText(override?.primaryPitchAccentDictionaryId),
  primaryPitchAccentReading: normalizePitchAccentReading(override?.primaryPitchAccentReading),
  primaryPitchAccentAccentNumber:
    typeof override?.primaryPitchAccentAccentNumber === "number" &&
    Number.isInteger(override.primaryPitchAccentAccentNumber)
      ? override.primaryPitchAccentAccentNumber
      : null,
  primaryPitchAccentIsCustom:
    typeof override?.primaryPitchAccentIsCustom === "boolean"
      ? override.primaryPitchAccentIsCustom
      : null,
});

export const isKanaPitchAccentReading = (value: string | null | undefined) => {
  const normalized = normalizePitchAccentReading(value);
  return Boolean(normalized && KANA_READING_PATTERN.test(normalized));
};

export const splitKanaIntoMoras = (value: string) => {
  const moras: string[] = [];
  const combiners = new Set([
    "ゃ",
    "ゅ",
    "ょ",
    "ぁ",
    "ぃ",
    "ぅ",
    "ぇ",
    "ぉ",
    "ゎ",
    "ャ",
    "ュ",
    "ョ",
    "ァ",
    "ィ",
    "ゥ",
    "ェ",
    "ォ",
    "ヮ",
  ]);

  for (const char of value) {
    if (combiners.has(char) && moras.length > 0) {
      moras[moras.length - 1] += char;
      continue;
    }

    moras.push(char);
  }

  return moras;
};

export const validateCustomPitchAccent = ({
  reading,
  accentNumber,
}: {
  reading: string | null | undefined;
  accentNumber: number | null | undefined;
}) => {
  const normalizedReading = normalizePitchAccentReading(reading);
  if (!normalizedReading) {
    return {
      isValid: false,
      normalizedReading: null,
      error: "Enter a reading.",
    } as const;
  }

  if (!KANA_READING_PATTERN.test(normalizedReading)) {
    return {
      isValid: false,
      normalizedReading,
      error: "Reading must be kana.",
    } as const;
  }

  if (!Number.isInteger(accentNumber)) {
    return {
      isValid: false,
      normalizedReading,
      error: "Accent number must be a whole number.",
    } as const;
  }

  const moraCount = splitKanaIntoMoras(normalizedReading).length;
  if (accentNumber! < 0 || accentNumber! > moraCount) {
    return {
      isValid: false,
      normalizedReading,
      error: `Accent number must be between 0 and ${moraCount}.`,
    } as const;
  }

  return {
    isValid: true,
    normalizedReading,
    moraCount,
    error: null,
  } as const;
};

export const resolveKnowledgePitchAccent = ({
  pitchAccents,
  override,
  preferredReading,
}: {
  pitchAccents: EntryPitchAccent[];
  override?: KnowledgePitchAccentOverride | null;
  preferredReading?: string | null;
}): ResolvedKnowledgePitchAccent => {
  const sorted = getSortedPitchAccents(pitchAccents, { preferredReading });
  const fallbackPrimary = sorted[0] ?? null;
  if (!fallbackPrimary) return null;

  const normalizedOverride = normalizeKnowledgePitchAccentOverride(override);
  if (normalizedOverride.primaryPitchAccentIsCustom) {
    const customValidation = validateCustomPitchAccent({
      reading: normalizedOverride.primaryPitchAccentReading,
      accentNumber: normalizedOverride.primaryPitchAccentAccentNumber,
    });

    if (customValidation.isValid) {
      return {
        mode: "custom",
        primary: null,
        primaryReading: customValidation.normalizedReading,
        primaryAccentNumber: normalizedOverride.primaryPitchAccentAccentNumber!,
        variants: sorted,
      };
    }
  }

  if (
    normalizedOverride.primaryPitchAccentDictionaryId &&
    normalizedOverride.primaryPitchAccentReading
  ) {
    const exactSelectedVariant =
      normalizedOverride.primaryPitchAccentAccentNumber !== null
        ? sorted.find(
            (variant) =>
              variant.dictionaryId === normalizedOverride.primaryPitchAccentDictionaryId &&
              getPitchAccentDisplayReading(variant) === normalizedOverride.primaryPitchAccentReading &&
              variant.accentNumber === normalizedOverride.primaryPitchAccentAccentNumber,
          ) ?? null
        : null;
    const selectedVariant =
      exactSelectedVariant ??
      sorted.find(
        (variant) =>
          variant.dictionaryId === normalizedOverride.primaryPitchAccentDictionaryId &&
          getPitchAccentDisplayReading(variant) === normalizedOverride.primaryPitchAccentReading,
      ) ??
      null;

    if (selectedVariant) {
      return {
        mode: "variant",
        primary: selectedVariant,
        primaryReading: getPitchAccentDisplayReading(selectedVariant),
        primaryAccentNumber: selectedVariant.accentNumber,
        variants: sorted.filter(
          (variant) => getPitchAccentVariantKey(variant) !== getPitchAccentVariantKey(selectedVariant),
        ),
      };
    }
  }

  return {
    mode: "default",
    primary: fallbackPrimary,
    primaryReading: getPitchAccentDisplayReading(fallbackPrimary),
    primaryAccentNumber: fallbackPrimary.accentNumber,
    variants: sorted.slice(1),
  };
};

export const getPitchAccentMoraLevels = ({
  moraCount,
  accentNumber,
}: {
  moraCount: number;
  accentNumber: number;
}): PitchAccentLevel[] => {
  if (moraCount <= 0) return [];

  return Array.from({ length: moraCount }, (_, index) => {
    if (accentNumber === 0) {
      return index === 0 ? "low" : "high";
    }

    if (accentNumber === 1) {
      return index === 0 ? "high" : "low";
    }

    if (index === 0) return "low";
    if (index < accentNumber) return "high";
    return "low";
  });
};

export const getPitchAccentDisplayLabel = (
  pitchAccents: EntryPitchAccent[],
  override?: KnowledgePitchAccentOverride | null,
  preferredReading?: string | null,
) => {
  const resolved = resolveKnowledgePitchAccent({ pitchAccents, override, preferredReading });
  if (!resolved) return null;

  const extraCount = resolved.variants.length;
  return extraCount > 0
    ? `${resolved.primaryAccentNumber} +${extraCount} more`
    : `${resolved.primaryAccentNumber}`;
};

export const formatPitchAccentSummary = (
  pitchAccents: EntryPitchAccent[],
  override?: KnowledgePitchAccentOverride | null,
  preferredReading?: string | null,
) => {
  const resolved = resolveKnowledgePitchAccent({ pitchAccents, override, preferredReading });
  if (!resolved) return null;

  const extraCount = resolved.variants.length;
  return extraCount > 0
    ? `Pitch accent ${resolved.primaryAccentNumber} +${extraCount} more`
    : `Pitch accent ${resolved.primaryAccentNumber}`;
};
