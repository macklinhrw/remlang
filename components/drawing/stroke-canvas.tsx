import {
  Canvas,
  Skia,
  Group,
  Line,
  SkPath,
  processTransform2d,
  Path,
  Mask,
  RoundedRect,
} from "@shopify/react-native-skia";
import { View, Text as RNText } from "react-native";
import "~/css/global.css";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import React from "react";

// Import Reanimated
import Animated, {
  useSharedValue,
  useDerivedValue,
  withTiming,
  interpolate,
  Extrapolation,
  Easing,
  SharedValue,
  runOnJS,
} from "react-native-reanimated";

// Import from the consolidated drawing module
import {
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  useDrawing,
  useStrokesRenderer,
  Stroke,
} from "~/lib/drawing";
import { validateStroke } from "~/lib/drawing/validation";
import { DOMParser } from "@xmldom/xmldom";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { getCharacterSvg, type CharacterLanguageId } from "@/lib/hooks/useZhSvg";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { useStrokeAnimationSpeed } from "@/lib/store/strokeAnimationSpeedStore";
import {
  Eye,
  EyeOff,
  Eraser,
  Hash,
  Play,
  Square,
} from "lucide-react-native";

// Color for strokes added by the app when correcting the user
const COMPLETED_STROKE_COLOR = "#F5F5F5"; // Light Gray
const ANIMATED_STROKE_COLOR = "#F5F5F5"; // White for animated preview
const BASE_ANIMATION_DURATION_PER_STROKE = 500; // milliseconds per stroke
const ANIMATED_MASK_STROKE_WIDTH = 60; // Increased width of the stroke used for masking
const ANIMATION_END_DELAY = 1000; // milliseconds after the last stroke to hide the animation

const SVG_SCALE = 0.85;
const ORDER_TINT_LIGHT_COLOR = "#F3F4F6";
const ORDER_TINT_DARK_COLOR = "#52525B";
const STROKE_NUMBER_BASE_SIZE = 20;
const STROKE_NUMBER_MIN_SIZE = 12;
const STROKE_NUMBER_SIZE_STEP = 2;
const STROKE_NUMBER_OFFSET = 10;
const STROKE_NUMBER_ALONG_PATH_OFFSET = 6;
const STROKE_NUMBER_COLLISION_GAP = 3;
const FRAME_RADIUS = 6;
const FRAME_BACKGROUND_COLOR = "#171717";
const FRAME_BORDER_COLOR = "#737373";

const hexToRgb = (value: string) => {
  const normalized = value.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : normalized;

  const numericValue = Number.parseInt(expanded, 16);

  return {
    r: (numericValue >> 16) & 255,
    g: (numericValue >> 8) & 255,
    b: numericValue & 255,
  };
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;

const interpolateColor = (from: string, to: string, progress: number) => {
  const start = hexToRgb(from);
  const end = hexToRgb(to);

  return rgbToHex(
    start.r + (end.r - start.r) * progress,
    start.g + (end.g - start.g) * progress,
    start.b + (end.b - start.b) * progress,
  );
};

const getStrokeOrderColor = (index: number, total: number) => {
  if (total <= 1) {
    return ORDER_TINT_LIGHT_COLOR;
  }

  return interpolateColor(
    ORDER_TINT_LIGHT_COLOR,
    ORDER_TINT_DARK_COLOR,
    index / (total - 1),
  );
};

// Define the new component outside Index for animating ONE stroke + fill
interface SingleAnimatedStrokeFillProps {
  fillPath: SkPath; // The path defining the fill shape
  animatablePath: SkPath; // The path defining the drawing animation
  index: number;
  animationProgress: SharedValue<number>;
  isAnimating: SharedValue<boolean>;
  fillColor: string;
  showAnimatedPreview: boolean;
}

const SingleAnimatedStrokeFill: React.FC<SingleAnimatedStrokeFillProps> =
  React.memo(
    ({
      fillPath,
      animatablePath,
      index,
      animationProgress,
      isAnimating,
      fillColor,
      showAnimatedPreview,
    }) => {
      // Derived value for the end of the stroke animation (0 to 1)
      const pathEnd = useDerivedValue(() => {
        // If animating, interpolate based on progress
        return interpolate(
          animationProgress.value,
          [index, index + 1], // This stroke animates between progress 'index' and 'index + 1'
          [0, 1], // Mapping progress range to pathEnd 0 -> 1
          Extrapolation.CLAMP,
        );
      }, []); // Only depends on animationProgress implicitly

      // Define the animated mask path element
      const animatedMask = useMemo(() => {
        return (
          <Path
            path={animatablePath} // Use the animation guide path
            style="stroke" // Mask is defined by a stroke
            strokeWidth={ANIMATED_MASK_STROKE_WIDTH} // Make it thick enough to cover the fill
            strokeCap="round" // Use butt caps for precise mask ends
            strokeJoin="round" // Keep round joins for corners within the stroke
            color="#FFFFFF" // White reveals in Skia masks
            start={0}
            end={pathEnd} // Animate the end of the mask stroke
          />
        );
      }, [animatablePath, pathEnd, isAnimating]); // Depends on the path and the derived end value

      // Return the Mask component with the animated mask and static fill content
      return (
        <Mask mask={animatedMask}>
          <Path path={fillPath} style="fill" color={fillColor} />
        </Mask>
      );
    },
  );
SingleAnimatedStrokeFill.displayName = "SingleAnimatedStrokeFill";

interface ICanvasProps {
  character: string;
  languageId?: CharacterLanguageId;
  width: number;
  height: number;
  showStaticPreview?: boolean;
  previewOpacity?: number;
  canChangeCharacter?: boolean;
  showOpacity?: number;
  showTotalStrokes?: boolean;
}

const StrokeCanvas: React.FC<ICanvasProps> = ({
  character,
  languageId = "lang_zh",
  width,
  height,
  showStaticPreview: showPreview = false,
  canChangeCharacter = false,
  previewOpacity = 0.5,
  showOpacity = 0.7,
  showTotalStrokes = true,
}) => {
  const [svgPaths, setSvgPaths] = useState<{
    fill: SkPath[];
    animatable: SkPath[];
  }>({ fill: [], animatable: [] });
  const [showAnimatedPreview, setShowAnimatedPreview] = useState(false); // Controls animation visibility
  const [showStaticPreview, setShowStaticPreview] = useState(showPreview); // Default to false
  const [showStrokeNumbers, setShowStrokeNumbers] = useState(false);
  const [strokeIndex, setStrokeIndex] = useState(0);
  const [animationStartStrokeIndex, setAnimationStartStrokeIndex] = useState(0);
  const [characterState, setCharacter] = useState(character);
  const frameClip = useMemo(
    () =>
      Skia.RRectXY(Skia.XYWHRect(0, 0, width, height), FRAME_RADIUS, FRAME_RADIUS),
    [height, width],
  );

  // Animation progress shared value (0 to numExpectedStrokes)
  const animationProgress = useSharedValue(0);
  const isAnimating = useSharedValue(false); // Track animation state
  const drizzle = useDrizzle();
  const { multiplier: animationSpeedMultiplier } = useStrokeAnimationSpeed();
  const animationDurationPerStroke = Math.max(
    1,
    Math.round(BASE_ANIMATION_DURATION_PER_STROKE / animationSpeedMultiplier),
  );

  // Use the drawing hook to manage drawing state and logic
  const {
    strokes,
    currentStrokeRef,
    strokeCount,
    forceRefresh,
    canvasRef,
    createPanResponder,
    clearStrokes,
    setStrokes,
    setStrokeCount,
    isDrawing,
  } = useDrawing(width, height);

  // Function to handle logic when animation finishes (runs on JS thread)
  const handleAnimationFinish = useCallback(() => {
    // Read the current state directly on the JS thread
    const isStaticPreviewEnabled = showStaticPreview;

    if (isStaticPreviewEnabled) {
      // If static background is showing, hide animation immediately
      setShowAnimatedPreview(false);
    } else {
      // If static background is hidden, hide animation after a delay
      setTimeout(() => {
        // Check isAnimating *again* inside the timeout, in case another animation started
        if (!isAnimating.value) {
          setShowAnimatedPreview(false);
        }
      }, ANIMATION_END_DELAY);
    }
  }, [showStaticPreview, setShowAnimatedPreview, isAnimating]); // Depends on state and shared value

  // Create pan responder with current color and width
  const panResponder = createPanResponder(DEFAULT_COLOR, DEFAULT_WIDTH);

  // Use the strokes renderer to render all user-drawn strokes
  const renderedStrokes = useStrokesRenderer({
    strokes: strokes,
    currentStroke: currentStrokeRef.current,
    forceRefresh,
  });

  // Load SVG character
  useEffect(() => {
    const loadSvg = async () => {
      if (character.length === 0) return;
      setShowAnimatedPreview(false); // Reset animation state on character change
      animationProgress.value = 0;
      isAnimating.value = false;
      // const svgKey = character.codePointAt(0)?.toString() || "";
      // const svgContent = await getZhSvg({
      //   character,
      // });
      let svgContent: string | undefined = undefined;
      try {
        const svgResult = await getCharacterSvg(drizzle, character, languageId);
        if (svgResult?.svg) {
          svgContent = svgResult.svg;
        }
      } catch (e) {
        console.log("Error fetching SVG:", e);
      }
      if (svgContent) {
        try {
          const parser = new DOMParser();
          const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");
          const paths = Array.from(svgDoc.getElementsByTagName("path"));

          const fillPathData: string[] = [];
          const strokePathData: string[] = []; // Paths to animate

          let potentialStrokePathsStart = -1;
          for (let i = 0; i < paths.length; i++) {
            const dAttribute = paths[i].getAttribute("d");
            if (dAttribute) {
              if (paths[i].hasAttribute("clip-path")) {
                // Found a stroke path
                if (potentialStrokePathsStart === -1)
                  potentialStrokePathsStart = i; // Mark start if first one
                strokePathData.push(dAttribute);
              } else if (potentialStrokePathsStart === -1) {
                // Haven't found strokes yet, assume fill
                fillPathData.push(dAttribute);
              } else {
                // Found strokes earlier, path without clip-path. Assume fill for now.
                fillPathData.push(dAttribute);
              }
            }
          }

          // Fallback logic
          if (strokePathData.length === 0 && paths.length > 0) {
            fillPathData.length = 0;
            strokePathData.length = 0;
            const halfIndex = Math.ceil(paths.length / 2);
            for (let i = 0; i < paths.length; i++) {
              const dAttribute = paths[i].getAttribute("d");
              if (dAttribute) {
                if (i < halfIndex) {
                  fillPathData.push(dAttribute);
                } else {
                  strokePathData.push(dAttribute);
                }
              }
            }
          } else if (fillPathData.length === 0 && strokePathData.length > 0) {
            // Fallback 2: Only found clip-path (stroke) paths. Copy them to fill.
            fillPathData.push(...strokePathData);
          }

          // Combine paths for transformation (fill first, then stroke)
          const pathData = [...fillPathData, ...strokePathData];
          const numFillOriginal = fillPathData.length; // Store original count
          const numStrokesOriginal = strokePathData.length; // Store original count

          if (numFillOriginal === 0 || numStrokesOriginal === 0) {
            console.warn(
              "SVG Loading: Missing either fill or stroke paths after processing.",
            );
            // Decide how to handle this - maybe skip setting state?
            setSvgPaths({ fill: [], animatable: [] }); // Clear paths
            return; // Exit early
          }

          // Transform to center (using combined pathData)
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;

          for (let i = 0; i < pathData.length; i++) {
            const parsed = Skia.Path.MakeFromSVGString(pathData[i]);
            if (!parsed) continue; // Skip invalid paths
            const bounds = parsed.getBounds();
            if (bounds.width === 0 && bounds.height === 0) continue; // Skip empty paths

            if (minX > bounds.x) minX = bounds.x;
            if (maxX < bounds.x + bounds.width) maxX = bounds.x + bounds.width;
            if (minY > bounds.y) minY = bounds.y;
            if (maxY < bounds.y + bounds.height)
              maxY = bounds.y + bounds.height;
          }

          const svgWidth = maxX - minX;
          const svgHeight = maxY - minY;

          if (
            !isFinite(svgWidth) ||
            !isFinite(svgHeight) ||
            svgWidth <= 0 ||
            svgHeight <= 0
          ) {
            console.warn("Invalid SVG bounds calculated for:", character);
            setSvgPaths({ fill: [], animatable: [] });
            return;
          }

          const svgCenterX = minX + svgWidth / 2;
          const svgCenterY = minY + svgHeight / 2;

          // Canvas measurement and transformation
          const measureAndTransform = () => {
            canvasRef.current?.measure(
              (x, y, canvasWidth, canvasHeight, pageXOffset, pageYOffset) => {
                if (!canvasWidth || !canvasHeight) return; // Ensure valid dimensions

                const canvasCenterX = canvasWidth / 2;
                const canvasCenterY = canvasHeight / 2;
                const scaleXFactor = canvasWidth / svgWidth;
                const scaleYFactor = canvasHeight / svgHeight;
                const scale = Math.min(scaleXFactor, scaleYFactor);
                const scaleMatrix = processTransform2d([
                  { translateX: canvasCenterX },
                  { translateY: canvasCenterY },
                  { scale: scale * SVG_SCALE },
                  { translateX: -svgCenterX },
                  { translateY: -svgCenterY },
                ]);

                const transformedPaths: SkPath[] = [];
                for (let i = 0; i < pathData.length; i++) {
                  const parsed = Skia.Path.MakeFromSVGString(pathData[i]);
                  if (!parsed) continue;
                  const transformed = parsed.transform(scaleMatrix);
                  if (transformed) {
                    // Check if transformation was successful
                    transformedPaths.push(transformed);
                  }
                }

                // Slice the transformed paths based on original counts
                const finalFillPaths = transformedPaths.slice(
                  0,
                  numFillOriginal,
                );
                const finalAnimatablePaths =
                  transformedPaths.slice(numFillOriginal);

                // Store the separated SkPath objects in the new state structure
                setSvgPaths({
                  fill: finalFillPaths,
                  animatable: finalAnimatablePaths,
                });
              },
            );
          };

          if (canvasRef.current) {
            measureAndTransform();
          } else {
            setTimeout(measureAndTransform, 50);
          }
        } catch (error) {
          console.error("Error parsing or processing SVG content:", error);
          setSvgPaths({ fill: [], animatable: [] }); // Reset state on error
        }
      } else {
        setSvgPaths({ fill: [], animatable: [] }); // Reset state if no content
      }
    };
    loadSvg();
  }, [character, drizzle, height, languageId, width, animationProgress, isAnimating]); // Added animation values to deps for reset

  // Get fill paths directly from state
  const fillPaths = useMemo(() => svgPaths.fill, [svgPaths.fill]);

  // Get animatable paths directly from state
  const animatablePaths = useMemo(
    () => svgPaths.animatable,
    [svgPaths.animatable],
  );

  // Calculate number of expected strokes based on animatable paths length
  const numExpectedStrokes = useMemo(
    () => animatablePaths.length,
    [animatablePaths],
  );

  // Render the static fill/outline part of the character
  const renderedFillPaths = useMemo(() => {
    if (!fillPaths.length) return null;
    return (
      <Group opacity={showAnimatedPreview ? previewOpacity : showOpacity}>
        {fillPaths.map((path, index) => (
          <Path
            key={`fill-${index}`}
            path={path}
            style="fill" // Changed to fill for background hint
            color={
              getStrokeOrderColor(index, fillPaths.length)
            }
          // strokeWidth={1} // Remove strokeWidth if using fill
          />
        ))}
      </Group>
    );
  }, [fillPaths, previewOpacity, showAnimatedPreview, showOpacity]);

  const renderedStrokeNumbers = useMemo(() => {
    if (!showStrokeNumbers || !animatablePaths.length) {
      return null;
    }

    const labels: Array<{
      id: string;
      index: number;
      left: number;
      top: number;
      size: number;
      fontSize: number;
    }> = [];
    const sizeCandidates: number[] = [];
    for (
      let size = STROKE_NUMBER_BASE_SIZE;
      size >= STROKE_NUMBER_MIN_SIZE;
      size -= STROKE_NUMBER_SIZE_STEP
    ) {
      sizeCandidates.push(size);
    }
    const offsetMultipliers = [0, 0.45, -0.45, 0.85, -0.85, 1.2, -1.2];

    return animatablePaths.map((path, index) => {
      let anchorLeft = width / 2;
      let anchorTop = height / 2;
      let tangentX = 0;
      let tangentY = 1;
      let normalX = 0;
      let normalY = -1;
      const pointCount = path.countPoints();

      if (pointCount > 0) {
        const startPoint = path.getPoint(0);
        anchorLeft = startPoint.x;
        anchorTop = startPoint.y;

        if (pointCount > 1) {
          const nextPoint = path.getPoint(1);
          const dx = nextPoint.x - startPoint.x;
          const dy = nextPoint.y - startPoint.y;
          const vectorLength = Math.hypot(dx, dy);

          if (vectorLength > 0) {
            tangentX = dx / vectorLength;
            tangentY = dy / vectorLength;
            normalX = -dy / vectorLength;
            normalY = dx / vectorLength;
          }
        }
      } else if (fillPaths[index]) {
        const bounds = fillPaths[index].getBounds();
        anchorLeft = bounds.x + bounds.width / 2;
        anchorTop = bounds.y + bounds.height / 2;
      }

      let chosenLabel:
        | {
            left: number;
            top: number;
            size: number;
            fontSize: number;
          }
        | undefined;

      for (const offsetMultiplier of offsetMultipliers) {
        for (const size of sizeCandidates) {
          const left = Math.max(
            size / 2,
            Math.min(
              width - size / 2,
              anchorLeft +
                tangentX * STROKE_NUMBER_ALONG_PATH_OFFSET +
                normalX * STROKE_NUMBER_OFFSET * offsetMultiplier,
            ),
          );
          const top = Math.max(
            size / 2,
            Math.min(
              height - size / 2,
              anchorTop +
                tangentY * STROKE_NUMBER_ALONG_PATH_OFFSET +
                normalY * STROKE_NUMBER_OFFSET * offsetMultiplier,
            ),
          );

          const overlapsExisting = labels.some((label) => {
            const minDistance =
              (label.size + size) / 2 + STROKE_NUMBER_COLLISION_GAP;
            return Math.hypot(label.left - left, label.top - top) < minDistance;
          });

          if (!overlapsExisting) {
            chosenLabel = {
              left,
              top,
              size,
              fontSize: Math.max(9, Math.round(size * 0.46)),
            };
            break;
          }
        }

        if (chosenLabel) {
          break;
        }
      }

      if (!chosenLabel) {
        const size = STROKE_NUMBER_MIN_SIZE;
        chosenLabel = {
          left: Math.max(
            size / 2,
            Math.min(
              width - size / 2,
              anchorLeft +
                tangentX * STROKE_NUMBER_ALONG_PATH_OFFSET +
                normalX * STROKE_NUMBER_OFFSET * 1.6,
            ),
          ),
          top: Math.max(
            size / 2,
            Math.min(
              height - size / 2,
              anchorTop +
                tangentY * STROKE_NUMBER_ALONG_PATH_OFFSET +
                normalY * STROKE_NUMBER_OFFSET * 1.6,
            ),
          ),
          size,
          fontSize: Math.max(9, Math.round(size * 0.46)),
        };
      }

      labels.push({
        id: `stroke-label-${index}`,
        index,
        ...chosenLabel,
      });

      return {
        id: `stroke-label-${index}`,
        index,
        ...chosenLabel,
      };
    });
  }, [animatablePaths, fillPaths, height, showStrokeNumbers, width]);

  // Stroke validation (using animatablePaths for indexing)
  useEffect(() => {
    const lastStroke = strokes[strokes.length - 1];
    if (!lastStroke || !animatablePaths.length) return;

    if (strokeIndex >= numExpectedStrokes) return; // Already finished

    const validationPath = animatablePaths[strokeIndex];

    if (!validationPath) return;

    const isValid = validateStroke(lastStroke, validationPath.toSVGString());

    setStrokes([]);

    if (isValid) {
      setStrokeIndex(strokeIndex + 1);
      if (strokeIndex + 1 === numExpectedStrokes) {
        setShowAnimatedPreview(false);
      }
    } else {
      // console.log("Stroke", strokeIndex, "is invalid");
    }
  }, [strokes, animatablePaths, strokeIndex, numExpectedStrokes, setStrokes]);

  // Reset function
  const handleReset = useCallback(
    (preview: boolean = false) => {
      clearStrokes();
      setStrokeIndex(0);
      setAnimationStartStrokeIndex(0);
      setShowAnimatedPreview(false); // Hide animation on reset
      setShowStaticPreview(preview); // Also hide static preview on reset
      animationProgress.value = 0; // Reset animation progress
      isAnimating.value = false;
    },
    [clearStrokes, animationProgress, isAnimating, setShowStaticPreview],
  ); // Add setShowStaticPreview dependency

  // Handle character change by resetting strokes
  useEffect(() => {
    handleReset(showPreview);
  }, [character]);

  // Toggle Animation Function
  const toggleAnimation = useCallback(() => {
    const currentlyVisible = showAnimatedPreview;
    const targetVisibility = !currentlyVisible;

    if (targetVisibility && numExpectedStrokes > 0) {
      const startStrokeIndex =
        strokeIndex >= numExpectedStrokes ? 0 : strokeIndex;
      const remainingStrokeCount = numExpectedStrokes - startStrokeIndex;

      if (remainingStrokeCount <= 0) {
        return;
      }

      setAnimationStartStrokeIndex(startStrokeIndex);
      animationProgress.value = startStrokeIndex;
      isAnimating.value = true;
      setShowAnimatedPreview(true);

      animationProgress.value = withTiming(
        numExpectedStrokes,
        {
          duration: remainingStrokeCount * animationDurationPerStroke,
          easing: Easing.linear,
        },
        (finished) => {
          isAnimating.value = false;

          if (finished) {
            runOnJS(handleAnimationFinish)();
          } else {
            runOnJS(setShowAnimatedPreview)(false);
          }
        },
      );
    } else {
      animationProgress.value = 0;
      isAnimating.value = false;
      setAnimationStartStrokeIndex(0);
      setShowAnimatedPreview(false);
    }
  }, [
    showAnimatedPreview,
    animationProgress,
    numExpectedStrokes,
    strokeIndex,
    animationDurationPerStroke,
    isAnimating,
    handleAnimationFinish,
    setShowAnimatedPreview,
  ]);

  // Handle Character Change
  const handleCharacterChange = useCallback(
    (text: string) => {
      if (text.length > 0) {
        const newChar = text.charAt(0); // Take the FIRST character entered
        if (newChar !== character) {
          // Prevent reset if character is the same
          setCharacter(newChar);
          handleReset();
        }
      } else {
        setCharacter("");
        handleReset();
      }
      // Handle empty input? Currently does nothing, which is probably fine.
    },
    [handleReset, character], // Keep dependencies
  );

  // Render the completed strokes drawn by the user so far
  const renderedCompletedStrokes = useMemo(() => {
    const completedStrokeCount = showAnimatedPreview
      ? animationStartStrokeIndex
      : strokeIndex;

    if (!fillPaths.length || completedStrokeCount === 0) return null;
    const pathsToRender = fillPaths.slice(0, completedStrokeCount);
    return (
      <Group>
        {pathsToRender.map((path, index) => (
          <Path
            key={`comp-${index}`}
            path={path}
            style="fill"
            color={COMPLETED_STROKE_COLOR}
          />
        ))}
      </Group>
    );
  }, [animationStartStrokeIndex, fillPaths, showAnimatedPreview, strokeIndex]);

  // Component to render the animated strokes
  const AnimatedStrokesPreview = useMemo(() => {
    if (
      !animatablePaths.length ||
      !fillPaths.length ||
      fillPaths.length !== animatablePaths.length ||
      !showAnimatedPreview
    ) {
      return null;
    }

    return (
      <Group>
        {Array.from({ length: numExpectedStrokes }).map((_, index) => {
          const fillPath = fillPaths[index];
          const animatablePath = animatablePaths[index];

          if (!fillPath || !animatablePath) {
            console.warn(`Missing paths for animation index ${index}`);
            return null;
          }

          return (
            <SingleAnimatedStrokeFill
              key={`anim-fill-${index}`}
              fillPath={fillPath}
              animatablePath={animatablePath}
              index={index}
              animationProgress={animationProgress}
              isAnimating={isAnimating}
              fillColor={ANIMATED_STROKE_COLOR} // Color of the revealed fill
              showAnimatedPreview={showAnimatedPreview}
            />
          );
        })}
      </Group>
    );
  }, [
    fillPaths,
    animatablePaths,
    numExpectedStrokes,
    showAnimatedPreview,
    animationProgress,
    isAnimating,
    handleAnimationFinish,
    setShowAnimatedPreview,
  ]);

  return (
    <View className="flex w-full">
      <View className="mt-1 w-full">
        {canChangeCharacter && (
          <View className="mb-3 flex-row items-center justify-between">
            <Text className="text-white">Character:</Text>
            <Input
              value={character}
              onChangeText={handleCharacterChange}
              className="bg-secondary text-white px-3 py-1 rounded w-16 text-center text-xl"
            />
          </View>
        )}
      </View>
      <View className="flex items-start" style={{ width }}>
        <View
          ref={canvasRef}
          {...panResponder.panHandlers}
          style={{ width, height, borderRadius: FRAME_RADIUS, overflow: "hidden" }}
        >
          <Canvas style={{ width, height }}>
            <RoundedRect
              x={0}
              y={0}
              width={width}
              height={height}
              r={FRAME_RADIUS}
              color={FRAME_BACKGROUND_COLOR}
            />
            <Group clip={frameClip}>
              {/* Grid Lines */}
              <Group>
                {/* Diagonal lines */}
                <Line
                  p1={{ x: 0, y: 0 }}
                  p2={{ x: width, y: height }}
                  color="#666666"
                  style="stroke"
                  strokeWidth={1}
                />
                <Line
                  p1={{ x: width, y: 0 }}
                  p2={{ x: 0, y: height }}
                  color="#666666"
                  style="stroke"
                  strokeWidth={1}
                />
                {/* Horizontal and vertical lines */}
                <Line
                  p1={{ x: 0, y: height / 2 }}
                  p2={{ x: width, y: height / 2 }}
                  color="#666666"
                  style="stroke"
                  strokeWidth={1}
                />
                <Line
                  p1={{ x: width / 2, y: 0 }}
                  p2={{ x: width / 2, y: height }}
                  color="#666666"
                  style="stroke"
                  strokeWidth={1}
                />
              </Group>

              {/* Static Background Character Outline (Fill Paths) */}
              {showStaticPreview && renderedFillPaths}

              {/* Animated Strokes Preview (Replaces static preview) */}
              {AnimatedStrokesPreview}

              {/* Completed Strokes Layer (Drawn by user) */}
              {renderedCompletedStrokes}

              {/* User-Drawn Strokes Layer (Current drawing) */}
              {!showAnimatedPreview && renderedStrokes}
            </Group>
            <RoundedRect
              x={0.5}
              y={0.5}
              width={width - 1}
              height={height - 1}
              r={FRAME_RADIUS}
              color={FRAME_BORDER_COLOR}
              style="stroke"
              strokeWidth={1}
            />
          </Canvas>
          {showStaticPreview && !showAnimatedPreview && renderedStrokeNumbers && (
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width,
                height,
              }}
            >
              {renderedStrokeNumbers.map((label) => (
                <View
                  key={label.id}
                  style={{
                    position: "absolute",
                    left: label.left - label.size / 2,
                    top: label.top - label.size / 2,
                    width: label.size,
                    height: label.size,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: "rgba(255, 255, 255, 0.65)",
                    backgroundColor: "rgba(17, 24, 39, 0.78)",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 2,
                  }}
                >
                  <RNText
                    style={{
                      color: "#FFFFFF",
                      fontSize: label.fontSize,
                      fontWeight: "700",
                    }}
                  >
                    {label.index + 1}
                  </RNText>
                </View>
              ))}
            </View>
          )}
        </View>

        <View className="mt-2 w-full flex-row items-center justify-between">
          <View className="flex-row items-baseline gap-2">
            <Text className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
              Strokes
            </Text>
            <Text className="text-lg font-semibold leading-none text-zinc-100">
              {strokeIndex}
            </Text>
            {showTotalStrokes && (
              <Text className="text-sm font-medium text-zinc-500">
                / {numExpectedStrokes}
              </Text>
            )}
            {animatablePaths.length > 0 && numExpectedStrokes === strokeIndex && (
              <View className="ml-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5">
                <Text className="text-[11px] font-medium text-emerald-300">Finished</Text>
              </View>
            )}
          </View>
          <View className="flex-row flex-wrap justify-end gap-2">
            <Button
              onPress={toggleAnimation}
              size="icon"
              variant="secondary"
              className={
                showAnimatedPreview
                  ? "border border-neutral-500 bg-neutral-700"
                  : ""
              }
              accessibilityLabel={
                showAnimatedPreview ? "Hide stroke animation" : "Show stroke animation"
              }
            >
              {showAnimatedPreview ? (
                <Square size={18} color="#E5E7EB" />
              ) : (
                <Play size={18} color="#9CA3AF" />
              )}
            </Button>
            <Button
              onPress={() => setShowStaticPreview(!showStaticPreview)}
              size="icon"
              variant="secondary"
              className={
                showStaticPreview
                  ? "border border-neutral-500 bg-neutral-700"
                  : ""
              }
              accessibilityLabel={
                showStaticPreview ? "Hide stroke preview background" : "Show stroke preview background"
              }
            >
              {showStaticPreview ? (
                <EyeOff size={18} color="#E5E7EB" />
              ) : (
                <Eye size={18} color="#9CA3AF" />
              )}
            </Button>
            <Button
              onPress={() => {
                setShowStaticPreview(true);
                setShowStrokeNumbers((value) => !value);
              }}
              size="icon"
              variant="secondary"
              className={
                showStrokeNumbers
                  ? "border border-neutral-500 bg-neutral-700"
                  : ""
              }
              accessibilityLabel={
                showStrokeNumbers ? "Hide stroke numbers" : "Show stroke numbers"
              }
            >
              <Hash
                size={18}
                color={showStrokeNumbers ? "#E5E7EB" : "#9CA3AF"}
              />
            </Button>
            <Button
              onPress={() => handleReset()}
              size="icon"
              accessibilityLabel="Clear drawn strokes"
            >
              <Eraser size={18} color="#FFFFFF" />
            </Button>
          </View>
        </View>
      </View>
    </View>
  );
};

export default StrokeCanvas;
