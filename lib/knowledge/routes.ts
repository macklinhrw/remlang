import type { Href } from "expo-router";

export type KnowledgeOriginPath =
	| `/deck/${string}`
	| `/deck/${string}/review`
	| `/folder/${string}/review`;

export type KnowledgeRouteOrigin = {
	cardId?: string | null;
	deckId?: string | null;
	deckName?: string | null;
	originPath?: KnowledgeOriginPath | null;
};

export const getKnowledgeRoute = (
	knowledgeId: string,
	origin?: KnowledgeRouteOrigin | null,
): Href => ({
	pathname: "/knowledge/[id]",
	params: {
		id: knowledgeId,
		cardId: origin?.cardId ?? undefined,
		deckId: origin?.deckId ?? undefined,
		deckName: origin?.deckName ?? undefined,
		originPath: origin?.originPath ?? undefined,
	},
});

const getFirstParamValue = (value: string | string[] | undefined) =>
	Array.isArray(value) ? value[0] : value;

export const parseKnowledgeRouteOrigin = (params: {
	cardId?: string | string[];
	deckId?: string | string[];
	deckName?: string | string[];
	originPath?: string | string[];
}) => {
	const cardId = getFirstParamValue(params.cardId) ?? null;
	const deckId = getFirstParamValue(params.deckId) ?? null;
	const deckName = getFirstParamValue(params.deckName) ?? null;
	const originPath = getFirstParamValue(params.originPath) ?? null;

	return {
		cardId,
		deckId,
		deckName,
		originPath:
			originPath &&
			(originPath.startsWith("/deck/") || originPath.startsWith("/folder/"))
				? (originPath as KnowledgeOriginPath)
				: null,
	};
};
