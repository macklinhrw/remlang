import type { ReviewType } from "@/lib/database/schema";

export const DEFAULT_REVIEW_TYPE: ReviewType = "Front-Back";

export const HIDDEN_REVIEW_TYPES = ["Tone", "Listening"] as const satisfies readonly ReviewType[];

export const VISIBLE_REVIEW_TYPES = [
	"Front-Back",
	"Back-Front",
	"Pitch",
	"Stroke",
] as const satisfies readonly ReviewType[];

export type VisibleReviewType = (typeof VISIBLE_REVIEW_TYPES)[number];

export const isVisibleReviewType = (
	reviewType: string | null | undefined,
): reviewType is VisibleReviewType =>
	VISIBLE_REVIEW_TYPES.includes(reviewType as VisibleReviewType);

export const normalizeVisibleReviewType = (
	reviewType: string | null | undefined,
): VisibleReviewType =>
	isVisibleReviewType(reviewType) ? reviewType : DEFAULT_REVIEW_TYPE;
