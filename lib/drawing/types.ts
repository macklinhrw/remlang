import { SkPoint } from "@shopify/react-native-skia";

export interface Stroke {
  points: SkPoint[];
  color: string;
  width: number;
  path?: any; // Cache the Skia path
}
