import { SkPoint, Skia } from "@shopify/react-native-skia";
import { MIN_POINT_DISTANCE } from "./constants";
import { Stroke } from "./types";

// Function to calculate distance between two points
export const distanceBetweenPoints = (p1: SkPoint, p2: SkPoint): number => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

// Function to simplify a path using distance-based point reduction
export const simplifyPath = (
  points: SkPoint[],
  minDistance: number
): SkPoint[] => {
  if (points.length <= 2) return points;

  const result: SkPoint[] = [points[0]];
  let lastPoint = points[0];

  for (let i = 1; i < points.length; i++) {
    const currentPoint = points[i];
    if (distanceBetweenPoints(lastPoint, currentPoint) >= minDistance) {
      result.push(currentPoint);
      lastPoint = currentPoint;
    }
  }

  // Always include the last point to ensure the stroke ends correctly
  if (
    points.length > 1 &&
    result[result.length - 1] !== points[points.length - 1]
  ) {
    result.push(points[points.length - 1]);
  }

  return result;
};

// Create a Skia path from points
export const createPathFromPoints = (points: SkPoint[]) => {
  if (!points || points.length === 0) return null;

  const path = Skia.Path.Make();

  path.moveTo(points[0].x, points[0].y);

  if (points.length > 1) {
    for (let i = 1; i < points.length; i++) {
      path.lineTo(points[i].x, points[i].y);
    }
  } else {
    // For single-point strokes, add a duplicate point
    path.lineTo(points[0].x, points[0].y);
  }

  return path;
};

// Create a finished stroke from current points
export const createFinishedStroke = (currentStroke: Stroke): Stroke | null => {
  if (
    !currentStroke ||
    !Array.isArray(currentStroke.points) ||
    currentStroke.points.length === 0
  ) {
    return null;
  }

  try {
    // Get the points from the current stroke
    const currentPoints = [...currentStroke.points];

    // Simplify the path before saving it
    const simplifiedPoints = simplifyPath(currentPoints, MIN_POINT_DISTANCE);

    // Precalculate the path for this stroke
    const path = createPathFromPoints(simplifiedPoints);

    if (!path) return null;

    return {
      points: simplifiedPoints.map((p) => ({ ...p })),
      color: currentStroke.color,
      width: currentStroke.width,
      path: path,
    };
  } catch (error) {
    console.error("Error creating finished stroke:", error);
    return null;
  }
};
