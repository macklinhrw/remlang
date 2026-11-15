import { useAccount } from "@/lib/auth/account";
import { Redirect, Stack } from "expo-router";

export default function AuthRoutesLayout() {
	const { isEnabled, isSignedIn, isLoaded } = useAccount();

	if (!isLoaded) {
		return null;
	}

	if (!isEnabled || isSignedIn) {
		return <Redirect href="/" />;
	}

	return <Stack screenOptions={{ headerShown: false }} />;
}
