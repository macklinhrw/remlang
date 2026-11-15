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

const getPremadeJson = async <TResponse>(url: string): Promise<TResponse> => {
	const response = await fetch(url, {
		method: "GET",
		headers: {
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

export const fetchCloudPremadeDecks = async (input?: {
	languageId?: string;
}) =>
	getPremadeJson<PremadeListResponse>(
		buildUrl("/", {
			languageId: input?.languageId,
		}),
	);

export const pullCloudPremadeDecks = async (input?: {
	cursor?: string | null;
	languageId?: string;
	limit?: number;
}) =>
	getPremadeJson<PremadePullResponse>(
		buildUrl("/pull", {
			cursor: input?.cursor ?? undefined,
			languageId: input?.languageId,
			limit: input?.limit,
		}),
	);
