import { View } from "react-native";
import { Text } from "@/components/ui/text";
import {
  formatPitchAccentSummary,
  type KnowledgePitchAccentOverride,
} from "@/lib/japanesePitchAccent";
import type { EntryDetailResult } from "@/lib/database/lexicon";

export const PitchAccentSummary = ({
  pitchAccents,
  className,
  textClassName,
  primaryOverride,
  preferredReading,
}: {
  pitchAccents: EntryDetailResult["pitchAccents"];
  className?: string;
  textClassName?: string;
  primaryOverride?: KnowledgePitchAccentOverride | null;
  preferredReading?: string | null;
}) => {
  const summary = formatPitchAccentSummary(pitchAccents, primaryOverride, preferredReading);
  if (!summary) return null;

  return (
    <View className={className}>
      <Text className={textClassName}>{summary}</Text>
    </View>
  );
};
