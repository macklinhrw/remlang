import { AuthView } from "@clerk/expo/native";
import { SignIn } from "@clerk/expo/web";
import { Platform } from "react-native";

export default function SignInPage() {
	return Platform.OS === "web" ? <SignIn /> : <AuthView mode="signIn" />;
}
