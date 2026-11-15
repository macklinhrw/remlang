import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import * as React from "react";

const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() || null;

/**
 * Accounts (and therefore cloud sync) are optional. Without a Clerk publishable
 * key the app runs fully offline: no sign-in screens, no sync.
 */
export const isAccountEnabled = clerkPublishableKey !== null;

export type Account = {
	isEnabled: boolean;
	isLoaded: boolean;
	isSignedIn: boolean;
	userId: string | null;
	email: string | null;
	getToken: () => Promise<string | null>;
	signOut: () => Promise<void>;
};

export function AccountProvider({ children }: { children: React.ReactNode }) {
	if (!clerkPublishableKey) {
		return <>{children}</>;
	}
	return (
		<ClerkProvider publishableKey={clerkPublishableKey} tokenCache={tokenCache}>
			{children}
		</ClerkProvider>
	);
}

function useClerkAccount(): Account {
	const { isLoaded, isSignedIn, getToken } = useAuth();
	const { user } = useUser();
	const { signOut } = useClerk();
	const email =
		user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress ?? null;
	const userId = user?.id ?? null;
	// Clerk's getToken/signOut are stable; keep the returned object stable too,
	// because sync effects list these in their dependency arrays.
	return React.useMemo(
		() => ({
			isEnabled: true,
			isLoaded,
			isSignedIn: Boolean(isSignedIn),
			userId,
			email,
			getToken,
			signOut: () => signOut(),
		}),
		[email, getToken, isLoaded, isSignedIn, signOut, userId],
	);
}

const offlineAccount: Account = {
	isEnabled: false,
	isLoaded: true,
	isSignedIn: false,
	userId: null,
	email: null,
	getToken: async () => null,
	signOut: async () => undefined,
};

function useOfflineAccount(): Account {
	return offlineAccount;
}

/** Chosen once at module load (the key is inlined at build time), so hook order is stable. */
export const useAccount: () => Account = isAccountEnabled ? useClerkAccount : useOfflineAccount;
