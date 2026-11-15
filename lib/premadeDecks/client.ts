import type {
	PremadeListResponse,
	PremadePullResponse,
} from "@/lib/premadeDecks/types";

const resolvePremadeApiBaseUrl = () => {
	const configuredUrl = process.env.EXPO_PUBLIC_SYNC_API_URL?.trim();

	if (!configuredUrl) {
		throw new Error(
			"Add EXPO_PUBLIC_SYNC_API_URL to the .env file before using cloud premade decks.",
		);
	}

	const normalizedUrl = configuredUrl.replace(/\/$/, "");

	if (normalizedUrl.endsWith("/api/v1/sync")) {
		return normalizedUrl.replace(/\/sync$/, "/premade-decks");
	}

	if (normalizedUrl.endsWith("/api/v1")) {
		return `${normalizedUrl}/premade-decks`;
	}

	return `${normalizedUrl}/api/v1/premade-decks`;
};

const buildUrl = (path: string, searchParams?: Record<string, string | number | undefined | null>) => {
	const url = new URL(`${resolvePremadeApiBaseUrl()}${path}`);

	if (searchParams) {
		for (const [key, value] of Object.entries(searchParams)) {
			if (value === undefined || value === null || value === "") {
				continue;
			}
			url.searchParams.set(key, String(value));
		}
	}

	return url.toString();
};

/** Premade decks are only served to signed-in users (textbook-derived content). */
const getPremadeJson = async <TResponse>(
	url: string,
	getToken: () => Promise<string | null>,
): Promise<TResponse> => {
	const token = await getToken();
	if (!token) {
		throw new Error("Sign in to load premade decks.");
	}

	const response = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
	});

	const payload = (await response.json().catch(() => null)) as
		| TResponse
		| { error?: string }
		| null;

	if (!response.ok) {
		const message =
			payload && typeof payload === "object" && "error" in payload
				? payload.error
				: null;
		throw new Error(message ?? `Premade request failed with status ${response.status}.`);
	}

	return payload as TResponse;
};

export const fetchCloudPremadeDecks = async (input: {
	getToken: () => Promise<string | null>;
	languageId?: string;
}) =>
	getPremadeJson<PremadeListResponse>(
		buildUrl("/", {
			languageId: input.languageId,
		}),
		input.getToken,
	);

export const pullCloudPremadeDecks = async (input: {
	getToken: () => Promise<string | null>;
	cursor?: string | null;
	languageId?: string;
	limit?: number;
}) =>
	getPremadeJson<PremadePullResponse>(
		buildUrl("/pull", {
			cursor: input.cursor ?? undefined,
			languageId: input.languageId,
			limit: input.limit,
		}),
		input.getToken,
	);
