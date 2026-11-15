import { AuthView } from "@clerk/expo/native";
import { SignUp } from "@clerk/expo/web";
import { Platform } from "react-native";

export default function SignUpPage() {
	return Platform.OS === "web" ? <SignUp /> : <AuthView mode="signUp" />;
}
