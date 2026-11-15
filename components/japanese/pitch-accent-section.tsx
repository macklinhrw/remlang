import React, { memo, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import type { EntryDetailResult } from "@/lib/database/lexicon";
import {
  getPitchAccentDisplayReading,
  getPitchAccentMoraLevels,
  resolveKnowledgePitchAccent,
  splitKanaIntoMoras,
  type KnowledgePitchAccentOverride,
} from "@/lib/japanesePitchAccent";
import { cn } from "@/lib/utils";

const HIGH_COLOR = [251, 113, 133] as const; // #fb7185
const LOW_COLOR = [96, 165, 250] as const; // #60a5fa
const GRADIENT_STEPS = 16;

const interpolateColor = (
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  t: number,
) => {
  const r = Math.round(from[0] + (to[0] - from[0]) * t);
  const g = Math.round(from[1] + (to[1] - from[1]) * t);
  const b = Math.round(from[2] + (to[2] - from[2]) * t);
  return `rgb(${r},${g},${b})`;
};

const highHex = `rgb(${HIGH_COLOR.join(",")})`;
const lowHex = `rgb(${LOW_COLOR.join(",")})`;

const BAR_HEIGHT = 3;

export const PitchAccentPattern = memo(function PitchAccentPattern({
  reading,
  accentNumber,
  compact = false,
}: {
  reading: string;
  accentNumber: number;
  compact?: boolean;
}) {
  const moras = useMemo(() => splitKanaIntoMoras(reading), [reading]);
  const levels = useMemo(
    () =>
      getPitchAccentMoraLevels({
        moraCount: moras.length,
        accentNumber,
      }),
    [accentNumber, moras.length],
  );

  const barHeight = compact ? 2 : BAR_HEIGHT;

  return (
    <View className="flex-row items-stretch justify-center">
      {moras.map((mora, index) => {
        const level = levels[index] ?? "low";
        const prevLevel = index > 0 ? (levels[index - 1] ?? "low") : undefined;
        const isTransition = prevLevel !== undefined && prevLevel !== level;

        return (
          <React.Fragment key={`${mora}-${index}`}>
            {isTransition && (
              <View style={{ width: compact ? 2 : 3 }}>
                <View style={{ height: barHeight, backgroundColor: highHex }} />
                <View style={{ flex: 1 }}>
                  {Array.from({ length: GRADIENT_STEPS }, (_, i) => (
                    <View
                      key={i}
                      style={{
                        flex: 1,
                        marginVertical: -0.5,
                        backgroundColor: interpolateColor(
                          HIGH_COLOR,
                          LOW_COLOR,
                          i / (GRADIENT_STEPS - 1),
                        ),
                      }}
                    />
                  ))}
                </View>
                <View style={{ height: barHeight, backgroundColor: lowHex }} />
              </View>
            )}
            <View className="items-center" style={{ marginHorizontal: isTransition ? 0 : -0.5 }}>
              <View
                style={{
                  height: barHeight,
                  alignSelf: "stretch",
                  backgroundColor: level === "high" ? highHex : "transparent",
                }}
              />
              <Text
                className={cn(
                  "font-semibold text-zinc-100",
                  compact
                    ? "px-1 text-[18px] leading-[22px]"
                    : "px-1.5 text-[30px] leading-[36px]",
                )}
              >
                {mora}
              </Text>
              <View
                style={{
                  height: barHeight,
                  alignSelf: "stretch",
                  backgroundColor: level === "low" ? lowHex : "transparent",
                }}
              />
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
});

export const PitchAccentSection = ({
  pitchAccents,
  className,
  primaryOverride,
  preferredReading,
  showHeader = true,
}: {
  pitchAccents: EntryDetailResult["pitchAccents"];
  className?: string;
  primaryOverride?: KnowledgePitchAccentOverride | null;
  preferredReading?: string | null;
  showHeader?: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const resolved = resolveKnowledgePitchAccent({
    pitchAccents,
    override: primaryOverride,
    preferredReading,
  });
  if (!resolved) return null;

  const variants = resolved.variants;
  const hasVariants = variants.length > 0;

  return (
    <View className={cn("border-t border-white/8 pt-4", className)}>
      {showHeader ? (
        <Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
          Pitch Accent
        </Text>
      ) : null}
      <View className="mt-3 items-center justify-center">
        <PitchAccentPattern
          reading={resolved.primaryReading}
          accentNumber={resolved.primaryAccentNumber}
        />
      </View>
      {hasVariants && (
        <>
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            className="mt-3 flex-row items-center justify-center gap-1"
            accessibilityLabel={expanded ? "Hide variant accents" : "Show variant accents"}
          >
            <Text className="text-xs font-medium text-zinc-500">
              {variants.length} variant{variants.length > 1 ? "s" : ""}
            </Text>
            {expanded ? (
              <ChevronDown size={14} color="#71717A" />
            ) : (
              <ChevronRight size={14} color="#71717A" />
            )}
          </Pressable>
          {expanded && (
            <View className="mt-3 flex-row flex-wrap items-center justify-center gap-2">
              {variants.map((variant, index) => {
                const reading = getPitchAccentDisplayReading(variant);
                return (
                  <View
                    key={`${index}-${variant.accentNumber}-${variant.dictionaryId}`}
                    className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-1.5"
                  >
                    <PitchAccentPattern
                      reading={reading}
                      accentNumber={variant.accentNumber}
                      compact
                    />
                  </View>
                );
              })}
            </View>
          )}
        </>
      )}
    </View>
  );
};
