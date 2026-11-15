import { Group, Path } from "@shopify/react-native-skia";
import { useMemo } from "react";
import { Stroke } from "./types";
import { DEFAULT_COLOR } from "./constants";
import { createPathFromPoints } from "./utils";

interface StrokesRendererProps {
  strokes: Stroke[];
  currentStroke: Stroke | null;
  forceRefresh: number;
}

export function useStrokesRenderer({
  strokes,
  currentStroke,
  forceRefresh,
}: StrokesRendererProps) {
  // Memoize the rendered strokes to avoid recreating components
  return useMemo(() => {
    // Create a shallow copy instead of using the same reference
    const allStrokes = [...strokes];

    // Add the current stroke if it exists and has points
    if (
      currentStroke &&
      Array.isArray(currentStroke.points) &&
      currentStroke.points.length > 0
    ) {
      allStrokes.push(currentStroke);
    }

    return allStrokes
      .map((stroke, index) => {
        // Extra safety check - allow single-point strokes
        if (
          !stroke ||
          !Array.isArray(stroke.points) ||
          stroke.points.length < 1
        )
          return null;

        try {
          // Use cached path if available for completed strokes
          const path = stroke.path || createPathFromPoints(stroke.points);

          if (!path) return null;

          return (
            <Group key={`stroke-${index}`}>
              <Path
                path={path}
                style="stroke"
                strokeWidth={stroke.width}
                color={stroke.color || DEFAULT_COLOR}
                strokeCap="round"
                strokeJoin="round"
                antiAlias={true}
              />
            </Group>
          );
        } catch (error) {
          console.error(`Error rendering stroke ${index}:`, error);
          return null;
        }
      })
      .filter(Boolean);
  }, [strokes, currentStroke, forceRefresh]);
}
