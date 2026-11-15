import { rebuildEntrySearchIndexSql } from "@/lib/database/searchIndex";
import type { SeedContext } from "./types";

export const rebuildEntrySearchIndex = (ctx: SeedContext) => {
  ctx.logger.info("rebuilding dictionary search index");
  ctx.sqlite.exec(rebuildEntrySearchIndexSql);
};
