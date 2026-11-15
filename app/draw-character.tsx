import { View, Text, useWindowDimensions } from "react-native";
import { useLocalSearchParams } from "expo-router";
import StrokeCanvas from "@/components/drawing/stroke-canvas";

export default function DrawCharacter() {
  const { character } = useLocalSearchParams();
  const { width: windowWidth } = useWindowDimensions();
  const width = windowWidth * 0.9;
  const height = width * 1;

  return (
    <View>
      <StrokeCanvas
        character={character as string}
        width={width}
        height={height}
      />
    </View>
  );
}
