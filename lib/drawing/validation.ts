import { SkPath, SkPoint, Skia } from "@shopify/react-native-skia";
// Use svg-path-parser and bezier-js
import { parseSVG, type Command } from "svg-path-parser";
import { Bezier } from "bezier-js";
import { Stroke } from "./types";

// Constants for validation
const NEEDED_DISTANCE_ACCURACY = 30;
const NEEDED_START_END_ACCURACY = 100;
// const NEEDED_DIRECTION_DOT_PRODUCT_THRESHOLD = 0.5; // No longer needed
const NUM_POINTS = 10; // Quality of lines/curves for sampling

// Function to calculate distance between two points
const distanceBetweenPoints = (p1: SkPoint, p2: SkPoint): number => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

// Transform SVG coordinates to canvas space
const transformSvgPoint = (
  point: { x: number; y: number },
  svgViewBoxWidth: number,
  svgViewBoxHeight: number,
  canvasWidth: number,
  canvasHeight: number
): SkPoint => {
  // Normalize to viewBox (0-1 range)
  const normalizedX = point.x / svgViewBoxWidth;
  const normalizedY = point.y / svgViewBoxHeight;

  // Scale to canvas dimensions
  return {
    x: normalizedX * canvasWidth,
    y: normalizedY * canvasHeight,
  };
};

// Calculate the total length of a stroke
const calculateStrokeLength = (points: SkPoint[]): number => {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += distanceBetweenPoints(points[i - 1], points[i]);
  }
  return length;
};

// Sample points along a path string using svg-path-parser and bezier-js
const samplePathPoints = (
  svgPathString: string,
  numPoints: number,
  svgViewBoxWidth: number,
  svgViewBoxHeight: number,
  canvasWidth: number,
  canvasHeight: number
): SkPoint[] => {
  const rawPoints: { x: number; y: number }[] = [];
  let lastPoint: { x: number; y: number } | null = null;
  let firstPointOfSubpath: { x: number; y: number } | null = null;

  try {
    const commands = parseSVG(svgPathString);
    console.log("\n--- Sampling SVG Path Commands ---");

    commands.forEach((command, index) => {
      // console.log(`Command ${index}:`, command); // Uncomment for deep debug
      if (command.code === "M") {
        // Absolute moveto
        lastPoint = { x: command.x, y: command.y };
        firstPointOfSubpath = lastPoint;
        rawPoints.push(lastPoint);
      } else if (command.code === "m") {
        // Relative moveto
        if (!lastPoint) {
          lastPoint = { x: command.x, y: command.y }; // Treat as absolute if first command
        } else {
          lastPoint = {
            x: lastPoint.x + command.x,
            y: lastPoint.y + command.y,
          };
        }
        firstPointOfSubpath = lastPoint;
        rawPoints.push(lastPoint);
      } else if (command.code === "L") {
        // Absolute lineto
        if (lastPoint) {
          // Interpolate points along the line
          for (let i = 1; i <= numPoints; i++) {
            const t = i / numPoints;
            const x = (1 - t) * lastPoint.x + t * command.x;
            const y = (1 - t) * lastPoint.y + t * command.y;
            rawPoints.push({ x, y });
          }
        }
        lastPoint = { x: command.x, y: command.y };
      } else if (command.code === "l") {
        // Relative lineto
        if (lastPoint) {
          const targetX = lastPoint.x + command.x;
          const targetY = lastPoint.y + command.y;
          for (let i = 1; i <= numPoints; i++) {
            const t = i / numPoints;
            const x = (1 - t) * lastPoint.x + t * targetX;
            const y = (1 - t) * lastPoint.y + t * targetY;
            rawPoints.push({ x, y });
          }
          lastPoint = { x: targetX, y: targetY };
        }
      } else if (command.code === "H") {
        // Absolute horizontal lineto
        if (lastPoint) {
          for (let i = 1; i <= numPoints; i++) {
            const t = i / numPoints;
            const x = (1 - t) * lastPoint.x + t * command.x;
            rawPoints.push({ x: x, y: lastPoint.y });
          }
        }
        lastPoint = { x: command.x, y: lastPoint?.y ?? 0 };
      } else if (command.code === "h") {
        // Relative horizontal lineto
        if (lastPoint) {
          const targetX = lastPoint.x + command.x;
          for (let i = 1; i <= numPoints; i++) {
            const t = i / numPoints;
            const x = (1 - t) * lastPoint.x + t * targetX;
            rawPoints.push({ x: x, y: lastPoint.y });
          }
          lastPoint = { x: targetX, y: lastPoint.y };
        }
      } else if (command.code === "V") {
        // Absolute vertical lineto
        if (lastPoint) {
          for (let i = 1; i <= numPoints; i++) {
            const t = i / numPoints;
            const y = (1 - t) * lastPoint.y + t * command.y;
            rawPoints.push({ x: lastPoint.x, y: y });
          }
        }
        lastPoint = { x: lastPoint?.x ?? 0, y: command.y };
      } else if (command.code === "v") {
        // Relative vertical lineto
        if (lastPoint) {
          const targetY = lastPoint.y + command.y;
          for (let i = 1; i <= numPoints; i++) {
            const t = i / numPoints;
            const y = (1 - t) * lastPoint.y + t * targetY;
            rawPoints.push({ x: lastPoint.x, y: y });
          }
          lastPoint = { x: lastPoint.x, y: targetY };
        }
      } else if (command.code === "C") {
        // Absolute curveto (cubic)
        if (lastPoint) {
          const bezier = new Bezier(
            lastPoint.x,
            lastPoint.y,
            command.x1,
            command.y1,
            command.x2,
            command.y2,
            command.x,
            command.y
          );
          const lut = bezier.getLUT(numPoints);
          // Add points from LUT (excluding start point if already added)
          lut.slice(1).forEach((p) => rawPoints.push(p));
        }
        lastPoint = { x: command.x, y: command.y };
      } else if (command.code === "c") {
        // Relative curveto (cubic)
        if (lastPoint) {
          const x1 = lastPoint.x + command.x1;
          const y1 = lastPoint.y + command.y1;
          const x2 = lastPoint.x + command.x2;
          const y2 = lastPoint.y + command.y2;
          const x = lastPoint.x + command.x;
          const y = lastPoint.y + command.y;
          const bezier = new Bezier(
            lastPoint.x,
            lastPoint.y,
            x1,
            y1,
            x2,
            y2,
            x,
            y
          );
          const lut = bezier.getLUT(numPoints);
          lut.slice(1).forEach((p) => rawPoints.push(p));
          lastPoint = { x, y };
        }
      } else if (command.code === "S") {
        // Absolute smooth curveto (cubic)
        // TODO: Need previous command to calculate reflected control point
        console.warn("'S' command not fully implemented for sampling");
        lastPoint = { x: command.x, y: command.y };
        rawPoints.push(lastPoint); // Add endpoint for now
      } else if (command.code === "s") {
        // Relative smooth curveto (cubic)
        // TODO: Need previous command to calculate reflected control point
        console.warn("'s' command not fully implemented for sampling");
        if (lastPoint) {
          lastPoint = {
            x: lastPoint.x + command.x,
            y: lastPoint.y + command.y,
          };
          rawPoints.push(lastPoint); // Add endpoint for now
        }
      } else if (command.code === "Q") {
        // Absolute quadratic curveto
        if (lastPoint) {
          const bezier = new Bezier(
            lastPoint.x,
            lastPoint.y,
            command.x1,
            command.y1,
            command.x,
            command.y
          );
          const lut = bezier.getLUT(numPoints);
          lut.slice(1).forEach((p) => rawPoints.push(p));
        }
        lastPoint = { x: command.x, y: command.y };
      } else if (command.code === "q") {
        // Relative quadratic curveto
        if (lastPoint) {
          const x1 = lastPoint.x + command.x1;
          const y1 = lastPoint.y + command.y1;
          const x = lastPoint.x + command.x;
          const y = lastPoint.y + command.y;
          const bezier = new Bezier(lastPoint.x, lastPoint.y, x1, y1, x, y);
          const lut = bezier.getLUT(numPoints);
          lut.slice(1).forEach((p) => rawPoints.push(p));
          lastPoint = { x, y };
        }
      } else if (command.code === "T") {
        // Absolute smooth quadratic curveto
        // TODO: Need previous command to calculate reflected control point
        console.warn("'T' command not fully implemented for sampling");
        lastPoint = { x: command.x, y: command.y };
        rawPoints.push(lastPoint); // Add endpoint for now
      } else if (command.code === "t") {
        // Relative smooth quadratic curveto
        // TODO: Need previous command to calculate reflected control point
        console.warn("'t' command not fully implemented for sampling");
        if (lastPoint) {
          lastPoint = {
            x: lastPoint.x + command.x,
            y: lastPoint.y + command.y,
          };
          rawPoints.push(lastPoint); // Add endpoint for now
        }
      } else if (command.code === "A") {
        // Absolute arc
        // TODO: Arc sampling is complex, skipping for now
        console.warn("'A' command sampling not implemented");
        lastPoint = { x: command.x, y: command.y };
        rawPoints.push(lastPoint); // Add endpoint for now
      } else if (command.code === "a") {
        // Relative arc
        // TODO: Arc sampling is complex, skipping for now
        console.warn("'a' command sampling not implemented");
        if (lastPoint) {
          lastPoint = {
            x: lastPoint.x + command.x,
            y: lastPoint.y + command.y,
          };
          rawPoints.push(lastPoint); // Add endpoint for now
        }
      } else if (command.code === "Z" || command.code === "z") {
        // Close path
        if (lastPoint && firstPointOfSubpath) {
          // Add line back to start if not already there
          if (distanceBetweenPoints(lastPoint, firstPointOfSubpath) > 1e-6) {
            for (let i = 1; i <= numPoints; i++) {
              const t = i / numPoints;
              const x = (1 - t) * lastPoint.x + t * firstPointOfSubpath.x;
              const y = (1 - t) * lastPoint.y + t * firstPointOfSubpath.y;
              rawPoints.push({ x, y });
            }
          }
          lastPoint = firstPointOfSubpath;
        }
        firstPointOfSubpath = null; // Reset for next potential subpath
      }
    });

    console.log(`Generated ${rawPoints.length} raw points for path sampling.`);
    console.log("--- End Sampling SVG Path Commands ---");

    // Apply transformation
    return rawPoints.map((rp, i) => {
      const transformedPoint = transformSvgPoint(
        rp,
        svgViewBoxWidth,
        svgViewBoxHeight,
        canvasWidth,
        canvasHeight
      );
      // console.log(`Sample ${i}: Raw=(${rp.x.toFixed(2)}, ${rp.y.toFixed(2)}), Transformed=(${transformedPoint.x.toFixed(2)}, ${transformedPoint.y.toFixed(2)})`); // Can be noisy
      return transformedPoint;
    });
  } catch (error) {
    console.error("Error parsing or sampling path string:", error);
    console.error("Path string:", svgPathString);
    return []; // Return empty on error
  }
};

// Calculate average distance between stroke and path string
const calculateDistance = (
  strokePath: SkPath,
  svgPathString: string,
  svgViewBoxWidth: number,
  svgViewBoxHeight: number,
  canvasWidth: number,
  canvasHeight: number
): number => {
  // Extract points from the stroke path commands
  const strokeCmds = strokePath.toCmds();
  // Filter out close commands (type 4) and map to points
  const strokePoints: SkPoint[] = strokeCmds
    .filter((cmd) => cmd.length > 1) // Ensure command has coordinates
    .map((cmd) => ({ x: cmd[cmd.length - 2], y: cmd[cmd.length - 1] })); // Last two are typically x, y

  if (strokePoints.length === 0) {
    console.warn("Could not extract points from stroke path.");
    return Infinity; // Return large distance if stroke is invalid
  }

  // Sample points from the SVG path string
  const pathPoints = samplePathPoints(
    svgPathString,
    NUM_POINTS, // Use the constant for sampling density
    svgViewBoxWidth,
    svgViewBoxHeight,
    canvasWidth,
    canvasHeight
  );

  if (pathPoints.length === 0) {
    console.warn("Could not sample points from SVG path string.");
    return Infinity; // Return large distance if path is invalid
  }

  console.log("\nDetailed Distance Analysis:");
  // console.log("Stroke Points (Canvas Coords):", strokePoints); // Noisy
  // console.log("Transformed SVG Points (Canvas Coords):", pathPoints); // Noisy

  let totalMinDistance = 0;
  strokePoints.forEach((strokePoint) => {
    let minDistance = Infinity;
    pathPoints.forEach((pathPoint) => {
      const distance = distanceBetweenPoints(strokePoint, pathPoint);
      if (distance < minDistance) {
        minDistance = distance;
      }
    });
    totalMinDistance += minDistance;
  });

  const avgDistance = totalMinDistance / strokePoints.length;
  console.log("Average Distance:", avgDistance);
  return avgDistance;
};

// Helper function to get start and end points from parsed commands
const getRawPathStartEnd = (
  commands: Command[]
): {
  start: { x: number; y: number } | null;
  end: { x: number; y: number } | null;
  isClosed: boolean;
} => {
  let start: { x: number; y: number } | null = null;
  let end: { x: number; y: number } | null = null;
  let currentPos: { x: number; y: number } = { x: 0, y: 0 };
  let isClosed = false;
  let foundStart = false;

  for (const command of commands) {
    let cmdEnd: { x: number; y: number } | null = null;
    const posBeforeCommand = { ...currentPos }; // Store position before executing command

    // Determine endpoint and update currentPos
    switch (command.code) {
      case "M":
        currentPos = { x: command.x, y: command.y };
        if (!foundStart) {
          start = currentPos;
          foundStart = true;
        }
        cmdEnd = currentPos;
        break;
      case "m":
        currentPos = {
          x: posBeforeCommand.x + command.x,
          y: posBeforeCommand.y + command.y,
        };
        if (!foundStart) {
          start = currentPos;
          foundStart = true;
        }
        cmdEnd = currentPos;
        break;
      case "L":
        cmdEnd = { x: command.x, y: command.y };
        break;
      case "l":
        cmdEnd = {
          x: posBeforeCommand.x + command.x,
          y: posBeforeCommand.y + command.y,
        };
        break;
      case "H":
        cmdEnd = { x: command.x, y: posBeforeCommand.y };
        break;
      case "h":
        cmdEnd = { x: posBeforeCommand.x + command.x, y: posBeforeCommand.y };
        break;
      case "V":
        cmdEnd = { x: posBeforeCommand.x, y: command.y };
        break;
      case "v":
        cmdEnd = { x: posBeforeCommand.x, y: posBeforeCommand.y + command.y };
        break;
      case "C":
        cmdEnd = { x: command.x, y: command.y };
        break;
      case "c":
        cmdEnd = {
          x: posBeforeCommand.x + command.x,
          y: posBeforeCommand.y + command.y,
        };
        break;
      case "S":
        cmdEnd = { x: command.x, y: command.y };
        break;
      case "s":
        cmdEnd = {
          x: posBeforeCommand.x + command.x,
          y: posBeforeCommand.y + command.y,
        };
        break;
      case "Q":
        cmdEnd = { x: command.x, y: command.y };
        break;
      case "q":
        cmdEnd = {
          x: posBeforeCommand.x + command.x,
          y: posBeforeCommand.y + command.y,
        };
        break;
      case "T":
        cmdEnd = { x: command.x, y: command.y };
        break;
      case "t":
        cmdEnd = {
          x: posBeforeCommand.x + command.x,
          y: posBeforeCommand.y + command.y,
        };
        break;
      case "A":
        cmdEnd = { x: command.x, y: command.y };
        break;
      case "a":
        cmdEnd = {
          x: posBeforeCommand.x + command.x,
          y: posBeforeCommand.y + command.y,
        };
        break;
      case "Z":
      case "z":
        cmdEnd = start;
        isClosed = true;
        break;
    }

    if (cmdEnd) {
      end = cmdEnd; // Keep track of the last definite point defined
      currentPos = cmdEnd; // Update current position for next iteration
    }
  }

  return { start, end, isClosed };
};

// Calculate distance between start and end points using path string
const calculateStartEndDistance = (
  strokePath: SkPath,
  svgPathString: string,
  svgViewBoxWidth: number,
  svgViewBoxHeight: number,
  canvasWidth: number,
  canvasHeight: number
): number => {
  try {
    const commands = parseSVG(svgPathString);
    const {
      start: rawPathStart,
      end: rawPathEnd,
      isClosed,
    } = getRawPathStartEnd(commands);

    if (isClosed) {
      console.log(
        "\nEndpoint Analysis: Path is closed, skipping distance check."
      );
      return 0;
    }

    if (!rawPathStart || !rawPathEnd) {
      console.warn("Could not determine start/end points from path string.");
      return Infinity;
    }

    const strokeStart = strokePath.getPoint(0);
    const strokeEnd = strokePath.getLastPt();

    if (!strokeStart || !strokeEnd) {
      console.warn("Could not get start/end points from stroke path.");
      return Infinity;
    }

    const pathStart = transformSvgPoint(
      rawPathStart,
      svgViewBoxWidth,
      svgViewBoxHeight,
      canvasWidth,
      canvasHeight
    );
    const pathEnd = transformSvgPoint(
      rawPathEnd,
      svgViewBoxWidth,
      svgViewBoxHeight,
      canvasWidth,
      canvasHeight
    );

    console.log("\nEndpoint Analysis:");
    console.log("Transformed Path Start:", pathStart);
    console.log("Transformed Path End:", pathEnd);

    // Calculate distances for both forward and reverse pairings
    const forwardStartDistance = distanceBetweenPoints(strokeStart, pathStart);
    const forwardEndDistance = distanceBetweenPoints(strokeEnd, pathEnd);
    const forwardAvgDistance = (forwardStartDistance + forwardEndDistance) / 2;

    const reverseStartDistance = distanceBetweenPoints(strokeStart, pathEnd);
    const reverseEndDistance = distanceBetweenPoints(strokeEnd, pathStart);
    const reverseAvgDistance = (reverseStartDistance + reverseEndDistance) / 2;

    console.log("Forward Endpoint Avg Distance:", forwardAvgDistance);
    console.log("Reverse Endpoint Avg Distance:", reverseAvgDistance);

    // Return the minimum average distance
    return Math.min(forwardAvgDistance, reverseAvgDistance);
  } catch (error) {
    console.error("Error calculating start/end distance:", error);
    console.error("Path string:", svgPathString);
    return Infinity; // Return large distance on error
  }
};

// Function to validate a stroke against an SVG path string
export const validateStroke = (
  stroke: Stroke,
  svgPathString: string,
  canvasWidth: number,
  canvasHeight: number,
  svgViewBoxWidth: number,
  svgViewBoxHeight: number
): boolean => {
  console.log("\n--- Stroke Validation Start --- (Using svg-path-parser) ---");
  console.log("Using Path String:", svgPathString);

  // Basic validation
  if (!stroke.points || stroke.points.length < 2) {
    console.log("Validation failed: Not enough points in stroke");
    return false;
  }

  // Create a Skia path from the stroke points
  const strokePath = Skia.Path.Make();
  strokePath.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (let i = 1; i < stroke.points.length; i++) {
    strokePath.lineTo(stroke.points[i].x, stroke.points[i].y);
  }
  const strokeLength = calculateStrokeLength(stroke.points); // Calculate length after creating path

  if (strokeLength < 5) {
    console.log(
      `Validation failed: Stroke length too short (${strokeLength.toFixed(2)})`
    );
    return false;
  }

  // Calculate distances using path string
  const avgDistance = calculateDistance(
    strokePath,
    svgPathString,
    svgViewBoxWidth,
    svgViewBoxHeight,
    canvasWidth,
    canvasHeight
  );
  const startEndDistance = calculateStartEndDistance(
    strokePath,
    svgPathString,
    svgViewBoxWidth,
    svgViewBoxHeight,
    canvasWidth,
    canvasHeight
  );

  // Calculate validation result based on distance and endpoints only
  const distanceValid = avgDistance < NEEDED_DISTANCE_ACCURACY;
  const endpointsValid = startEndDistance < NEEDED_START_END_ACCURACY;
  const isValid = distanceValid && endpointsValid;

  // --- Get path properties (including closed status) ---
  let isPathClosed = false;
  try {
    const commands = parseSVG(svgPathString);
    const pathInfo = getRawPathStartEnd(commands);
    isPathClosed = pathInfo.isClosed;
  } catch (error) {
    console.error("Error parsing path for closed status check:", error);
    // Proceed assuming path is not closed if parsing fails here
  }
  // ------------------------------------------------------

  // Debug output
  console.log("Validation Metrics:", {
    avgDistance,
    distanceThreshold: NEEDED_DISTANCE_ACCURACY,
    distanceValid,

    startEndDistance,
    endpointThreshold: NEEDED_START_END_ACCURACY,
    endpointsValid,

    strokePoints: stroke.points.length,
    strokeLength,

    isValid,
    isPathClosed, // Add closed path status to log
  });

  console.log("--- Stroke Validation End ---");

  return isValid;
};
