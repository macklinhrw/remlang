import { useCallback, useRef, useState, useEffect } from "react";
import { PanResponder, View } from "react-native";
import { vec } from "@shopify/react-native-skia";
import { Stroke } from "./types";
import { MAX_STROKES, MIN_POINT_DISTANCE } from "./constants";
import { distanceBetweenPoints, createFinishedStroke } from "./utils";

export function useDrawing(width: number, height: number) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const lastPointTimeRef = useRef<number>(0);
  const frameRequestRef = useRef<number | null>(null);
  const canvasRef = useRef<View>(null);
  const [strokeCount, setStrokeCount] = useState(0);
  const [isDrawing, setIsDrawing] = useState(false);
  const [forceRefresh, setForceRefresh] = useState(0);

  // Cleanup function to ensure we don't leave frame callbacks hanging
  useEffect(() => {
    return () => {
      if (frameRequestRef.current !== null) {
        cancelAnimationFrame(frameRequestRef.current);
      }
    };
  }, []);

  const finishStroke = useCallback(() => {
    if (
      currentStrokeRef.current &&
      Array.isArray(currentStrokeRef.current.points) &&
      currentStrokeRef.current.points.length > 0
    ) {
      const strokeToSave = createFinishedStroke(currentStrokeRef.current);

      if (strokeToSave) {
        setStrokes((prevStrokes) => {
          if (prevStrokes.length >= MAX_STROKES) {
            return [
              ...prevStrokes.slice(prevStrokes.length - MAX_STROKES + 1),
              strokeToSave,
            ];
          }
          return [...prevStrokes, strokeToSave];
        });

        setStrokeCount((prev) => prev + 1);
      }
    }

    currentStrokeRef.current = null;
  }, []);

  const addPoint = useCallback(
    (x: number, y: number, color: string, strokeWidth: number) => {
      // Only check actual bounds of the canvas, not distance between points
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        isNaN(x) ||
        isNaN(y) ||
        x < 0 ||
        x > width ||
        y < 0 ||
        y > height
      ) {
        return;
      }

      const now = Date.now();
      const timeSinceLastPoint = now - lastPointTimeRef.current;

      // Skip points if we're adding them too quickly, except for the first few points
      if (
        currentStrokeRef.current &&
        Array.isArray(currentStrokeRef.current.points) &&
        currentStrokeRef.current.points.length > 3 &&
        timeSinceLastPoint < 5
      ) {
        return;
      }

      lastPointTimeRef.current = now;

      try {
        const point = vec(x, y);

        if (!currentStrokeRef.current) {
          currentStrokeRef.current = {
            points: [point],
            color,
            width: strokeWidth,
          };
        } else if (Array.isArray(currentStrokeRef.current.points)) {
          const points = currentStrokeRef.current.points;

          if (points.length === 0) {
            points.push(point);
          } else {
            const lastPoint = points[points.length - 1];

            // Always add the first few points to ensure smooth start
            if (
              points.length < 3 ||
              distanceBetweenPoints(lastPoint, point) >= MIN_POINT_DISTANCE / 2
            ) {
              // Add points no matter the distance - let the user draw quickly
              points.push(point);
            }
          }
        } else {
          currentStrokeRef.current.points = [point];
        }

        if (frameRequestRef.current === null) {
          frameRequestRef.current = requestAnimationFrame(() => {
            setForceRefresh((prev) => prev + 1);
            frameRequestRef.current = null;
          });
        }
      } catch (error) {
        console.error("Error adding point:", error);
      }
    },
    [width, height]
  );

  const createPanResponder = useCallback(
    (color: string, strokeWidth: number) => {
      return PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          const { pageX, pageY } = event.nativeEvent;

          // Get canvas position to calculate relative coordinates
          canvasRef.current?.measure(
            (x, y, width, height, pageXOffset, pageYOffset) => {
              const relativeX = pageX - pageXOffset;
              const relativeY = pageY - pageYOffset;

              if (
                relativeX >= 0 &&
                relativeX <= width &&
                relativeY >= 0 &&
                relativeY <= height
              ) {
                setIsDrawing(true);
                addPoint(relativeX, relativeY, color, strokeWidth);
              }
            }
          );
        },
        onPanResponderMove: (event) => {
          if (!isDrawing) return;

          const { pageX, pageY } = event.nativeEvent;

          // Get canvas position to calculate relative coordinates
          canvasRef.current?.measure(
            (x, y, width, height, pageXOffset, pageYOffset) => {
              const relativeX = pageX - pageXOffset;
              const relativeY = pageY - pageYOffset;

              if (
                relativeX >= 0 &&
                relativeX <= width &&
                relativeY >= 0 &&
                relativeY <= height
              ) {
                addPoint(relativeX, relativeY, color, strokeWidth);
              } else {
                finishStroke();
                setIsDrawing(false);
              }
            }
          );
        },
        onPanResponderRelease: () => {
          if (isDrawing) {
            finishStroke();
            setIsDrawing(false);
          }
        },
        onPanResponderTerminate: () => {
          if (isDrawing) {
            finishStroke();
            setIsDrawing(false);
          }
        },
        onPanResponderTerminationRequest: () => false,
      });
    },
    [addPoint, finishStroke, isDrawing, width, height]
  );

  useEffect(() => {
    // update number strokes
    setStrokeCount(strokes.length);
  }, [strokes]);

  const clearStrokes = useCallback(() => {
    setStrokes([]);
    currentStrokeRef.current = null;
  }, []);

  return {
    strokes,
    currentStrokeRef,
    strokeCount,
    isDrawing,
    forceRefresh,
    canvasRef,
    createPanResponder,
    clearStrokes,
    finishStroke,
    addPoint,
    setStrokes,
    setStrokeCount,
    setForceRefresh,
  };
}
