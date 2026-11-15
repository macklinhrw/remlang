import * as schema from "@/lib/database/schema";
import { chunk } from "./utils";
import type { NormalizedSeedData, SeedContext } from "./types";

const insertChunks = async <T>(
  ctx: SeedContext,
  label: string,
  table: any,
  rows: T[] | undefined,
) => {
  if (!rows || rows.length === 0) return 0;
  for (const batch of chunk(rows, ctx.batchSize)) {
    await ctx.db.insert(table).values(batch as any).onConflictDoNothing();
  }
  ctx.logger.info(`loaded ${label}`, { count: rows.length });
  return rows.length;
};

const upsertLanguages = async (
  ctx: SeedContext,
  rows: NonNullable<NormalizedSeedData["languages"]>,
) => {
  for (const row of rows) {
    await ctx.db
      .insert(schema.languages)
      .values(row)
      .onConflictDoUpdate({
        target: schema.languages.id,
        set: {
          code: row.code,
          name: row.name,
          defaultGlossLanguage: row.defaultGlossLanguage ?? null,
          isEnabled: row.isEnabled ?? true,
        },
      });
  }
  return rows.length;
};

const upsertDictionaries = async (
  ctx: SeedContext,
  rows: NonNullable<NormalizedSeedData["dictionaries"]>,
) => {
  for (const row of rows) {
    await ctx.db
      .insert(schema.dictionaries)
      .values(row)
      .onConflictDoUpdate({
        target: schema.dictionaries.id,
        set: {
          name: row.name,
          languageId: row.languageId ?? null,
          slug: row.slug ?? null,
          sourceType: row.sourceType ?? null,
          sourceUrl: row.sourceUrl ?? null,
          versionTag: row.versionTag ?? null,
          dictDate: row.dictDate ?? null,
          license: row.license ?? null,
          seedModule: row.seedModule ?? null,
        },
      });
  }
  return rows.length;
};

export const loadNormalizedData = async (
  data: NormalizedSeedData,
  ctx: SeedContext,
) => {
  const counts: Record<string, number> = {};

  if (data.languages?.length) {
    counts.languages = await upsertLanguages(ctx, data.languages);
  }
  if (data.dictionaries?.length) {
    counts.dictionaries = await upsertDictionaries(ctx, data.dictionaries);
  }

  counts.entries = await insertChunks(ctx, "entries", schema.entries, data.entries);
  counts.entryForms = await insertChunks(
    ctx,
    "entry forms",
    schema.entryForms,
    data.entryForms,
  );
  counts.entryReadings = await insertChunks(
    ctx,
    "entry readings",
    schema.entryReadings,
    data.entryReadings,
  );
  counts.entrySenses = await insertChunks(
    ctx,
    "entry senses",
    schema.entrySenses,
    data.entrySenses,
  );
  counts.senseGlosses = await insertChunks(
    ctx,
    "sense glosses",
    schema.senseGlosses,
    data.senseGlosses,
  );
  counts.entryRelations = await insertChunks(
    ctx,
    "entry relations",
    schema.entryRelations,
    data.entryRelations,
  );
  counts.examples = await insertChunks(ctx, "examples", schema.examples, data.examples);
  counts.exampleTranslations = await insertChunks(
    ctx,
    "example translations",
    schema.exampleTranslations,
    data.exampleTranslations,
  );
  counts.entryExamples = await insertChunks(
    ctx,
    "entry examples",
    schema.entryExamples,
    data.entryExamples,
  );
  counts.zhEntryData = await insertChunks(
    ctx,
    "zh entry data",
    schema.zhEntryData,
    data.zhEntryData,
  );
  counts.zhCharacterData = await insertChunks(
    ctx,
    "zh character data",
    schema.zhCharacterData,
    data.zhCharacterData,
  );
  counts.jaEntryData = await insertChunks(
    ctx,
    "ja entry data",
    schema.jaEntryData,
    data.jaEntryData,
  );
  counts.jaPitchAccents = await insertChunks(
    ctx,
    "ja pitch accents",
    schema.jaPitchAccents,
    data.jaPitchAccents,
  );
  counts.jaCharacterData = await insertChunks(
    ctx,
    "ja character data",
    schema.jaCharacterData,
    data.jaCharacterData,
  );
  counts.jaCharacterComponents = await insertChunks(
    ctx,
    "ja character components",
    schema.jaCharacterComponents,
    data.jaCharacterComponents,
  );
  counts.jaRadicals = await insertChunks(
    ctx,
    "ja radicals",
    schema.jaRadicals,
    data.jaRadicals,
  );
  counts.jaRadicalCharacters = await insertChunks(
    ctx,
    "ja radical characters",
    schema.jaRadicalCharacters,
    data.jaRadicalCharacters,
  );

  return counts;
};
