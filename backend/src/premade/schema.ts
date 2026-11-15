import { z } from "zod";

export const premadeListQuerySchema = z.object({
  languageId: z.string().trim().min(1).optional(),
});

export const premadePullQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
  languageId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});

export type PremadeListQuery = z.infer<typeof premadeListQuerySchema>;
export type PremadePullQuery = z.infer<typeof premadePullQuerySchema>;
