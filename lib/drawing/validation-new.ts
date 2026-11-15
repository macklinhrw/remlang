import { Command, parseSVG } from "svg-path-parser";
import {
  NEEDED_DIRECTION_ACCURACY,
  NEEDED_DISTANCE_ACCURACY,
  NEEDED_START_END_ACCURACY,
  Stroke,
} from ".";
import { Bezier } from "bezier-js";

const NUM_POINTS = 10;
const Y_OFFSET = 0;
const X_OFFSET = 0;

export const validateStroke = (stroke: Stroke, svgPathString: string) => {
  // console.log("validateStroke", stroke);
  // console.log("svgPathString", svgPathString);
  const strokePoints: [number, number][] = stroke.points.map((p) => [
    p.x + X_OFFSET,
    p.y + Y_OFFSET,
  ]);

  const parsedSvg = parseSVG(svgPathString);
  const distances = calculateDistances(strokePoints, parsedSvg);
  // console.log("distances", distances);

  const startEndResult = calculateDistanceStartEnd(
    strokePoints[0],
    strokePoints[strokePoints.length - 1],
    parsedSvg
  );
  // console.log("startEndResult", startEndResult);

  const directionResult = checkDirectionMatch(
    strokePoints[0],
    strokePoints[strokePoints.length - 1],
    parsedSvg
  );
  // console.log("directionResult", directionResult);

  const isAccurateDistance =
    distances.averageDistance < NEEDED_DISTANCE_ACCURACY;
  const isAccurateStartEnd = startEndResult < NEEDED_START_END_ACCURACY;
  const isAccurateDirection = directionResult;
  const isValid =
    isAccurateDistance && isAccurateStartEnd && isAccurateDirection;

  // console.log("isValid", {
  //   isValid,
  //   isAccurateDistance,
  //   isAccurateStartEnd,
  //   isAccurateDirection,
  // });

  return isValid;
};

function calculateDistances(line: [number, number][], parsedSvg: Command[]) {
  // Convert the SVG path into an array of points.
  const pathPoints: [number, number][] = [];
  let lastPoint: [number, number] | null = null;
  parsedSvg.forEach((command) => {
    if (command.command === "moveto") {
      pathPoints.push([command.x, command.y]);
      lastPoint = [command.x, command.y];
    } else if (command.command === "lineto") {
      // Generate points along the line using linear interpolation.
      if (lastPoint) {
        const numPoints = NUM_POINTS; // Adjust as needed.
        for (let i = 0; i <= numPoints; i++) {
          const t = i / numPoints;
          const x = (1 - t) * lastPoint[0] + t * command.x;
          const y = (1 - t) * lastPoint[1] + t * command.y;
          pathPoints.push([x, y]);
        }
      }
      lastPoint = [command.x, command.y];
    } else if (command.command === "curveto") {
      // Generate points along the curve using bezier-js.
      const bezier = new Bezier(
        command.x1,
        command.y1,
        command.x2,
        command.y2,
        command.x,
        command.y
      );
      const curveLength = bezier.length();
      const numPoints = Math.max(
        NUM_POINTS,
        Math.round(curveLength / NUM_POINTS)
      ); // Generate one point every 10 units along the curve.
      const curvePoints = bezier.getLUT(numPoints);
      curvePoints.forEach((point) => {
        pathPoints.push([point.x, point.y]);
      });
      lastPoint = [command.x, command.y];
    } else if (command.command === "quadratic curveto") {
      // Generate points along the quadratic curve using bezier-js.
      if (lastPoint) {
        const bezier = new Bezier(
          lastPoint[0],
          lastPoint[1],
          command.x1,
          command.y1,
          command.x,
          command.y
        );
        const numPoints = NUM_POINTS; // Adjust as needed.
        const curvePoints = bezier.getLUT(numPoints);
        curvePoints.forEach((point) => {
          pathPoints.push([point.x, point.y]);
        });
      }
      lastPoint = [command.x, command.y];
    }
  });

  // For each point on the line, calculate the minimum distance to any point on the SVG path.
  let totalMinDistance = 0;
  line.forEach((linePoint) => {
    let minDistance = Infinity;
    pathPoints.forEach((pathPoint) => {
      const dx = linePoint[0] - pathPoint[0];
      const dy = linePoint[1] - pathPoint[1];
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < minDistance) {
        minDistance = distance;
      }
    });
    totalMinDistance += minDistance;
  });
  // Return the average minimum distance.
  return { averageDistance: totalMinDistance / line.length };
}

function calculateDistanceStartEnd(
  start: [number, number],
  end: [number, number],
  parsedSvg: Command[]
) {
  // Find the start and end points of the SVG path.
  let svgStart: [number, number] | null = null;
  let svgEnd: [number, number] | null = null;
  parsedSvg.forEach((command) => {
    if (command.command === "moveto" && svgStart === null) {
      svgStart = [command.x, command.y];
    }
    if (
      command.command === "curveto" ||
      command.command === "lineto" ||
      command.command === "quadratic curveto"
    ) {
      svgEnd = [command.x, command.y];
    }
  });

  if (svgStart === null || svgEnd === null) {
    throw new Error("SVG path does not have a valid start or end point");
  }

  // Calculate the distance between the start points and the end points.
  const dxStart = start[0] - svgStart[0];
  const dyStart = start[1] - svgStart[1];
  const startDistance = Math.sqrt(dxStart * dxStart + dyStart * dyStart);

  const dxEnd = end[0] - svgEnd[0];
  const dyEnd = end[1] - svgEnd[1];
  const endDistance = Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd);

  // Return the average of the start distance and the end distance.
  return (startDistance + endDistance) / 2;
}

// Checks if the direction, left-to-right, top-to-bottom, bottom-to-top, horizontal, etc
// matches on both strokes
function checkDirectionMatch(
  start: [number, number],
  end: [number, number],
  parsedSvg: Command[]
): boolean {
  // Find the start and end points of the SVG path.
  let svgStart: [number, number] | null = null;
  let svgEnd: [number, number] | null = null;
  parsedSvg.forEach((command) => {
    if (command.command === "moveto" && svgStart === null) {
      svgStart = [command.x, command.y];
    }
    if (
      command.command === "lineto" ||
      command.command === "curveto" ||
      command.command === "quadratic curveto"
    ) {
      svgEnd = [command.x, command.y];
    }
  });

  if (svgStart === null || svgEnd === null) {
    return false;
  }

  // Calculate the differences in the x and y coordinates for the user's line and the SVG path.
  const dxLine = end[0] - start[0];
  const dyLine = end[1] - start[1];
  const dxSvg = svgEnd[0] - svgStart[0];
  const dySvg = svgEnd[1] - svgStart[1];

  // direction:
  // top-bottom, bottom-top, left-right, right-left
  // topleft-bottomleft, bottomleft-topleft
  // topright-bottomright, bottomright-topright

  // Check if the directions match.
  // The directions are considered to match if the absolute values of the differences are within a certain tolerance.
  const tolerance = NEEDED_DIRECTION_ACCURACY; // Adjust as needed.
  const xDirectionMatches = Math.abs(dxLine - dxSvg) <= tolerance;
  const yDirectionMatches = Math.abs(dyLine - dySvg) <= tolerance;

  return xDirectionMatches && yDirectionMatches;
}

// TODO:
// Create function for comparing line length --
// so dots aren't valid, because endDiff doesn't account
// needs to be closer in length
