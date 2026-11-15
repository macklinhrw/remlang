import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "@/lib/database/schema";
import type { SeedLogger } from "./logger";

export type SeedDb = BetterSQLite3Database<typeof schema>;

export interface SeedContext {
  db: SeedDb;
  sqlite: Database.Database;
  rootDir: string;
  resourcesDir: string;
  outputDbPath: string;
  enabledLanguages: string[];
  batchSize: number;
  logger: SeedLogger;
}

export interface SeedDictionary {
  id: string;
  languageId: string;
  slug: string;
  name: string;
  sourceType: string;
  sourceUrl?: string;
  versionTag?: string;
  dictDate?: string;
  license?: string;
  seedModule: string;
}

export interface ValidationReport {
  valid: boolean;
  warnings: string[];
  counts?: Record<string, number>;
}

export interface NormalizedSeedData {
  languages?: (typeof schema.languages.$inferInsert)[];
  dictionaries?: (typeof schema.dictionaries.$inferInsert)[];
  entries?: (typeof schema.entries.$inferInsert)[];
  entryForms?: (typeof schema.entryForms.$inferInsert)[];
  entryReadings?: (typeof schema.entryReadings.$inferInsert)[];
  entrySenses?: (typeof schema.entrySenses.$inferInsert)[];
  senseGlosses?: (typeof schema.senseGlosses.$inferInsert)[];
  entryRelations?: (typeof schema.entryRelations.$inferInsert)[];
  examples?: (typeof schema.examples.$inferInsert)[];
  exampleTranslations?: (typeof schema.exampleTranslations.$inferInsert)[];
  entryExamples?: (typeof schema.entryExamples.$inferInsert)[];
  zhEntryData?: (typeof schema.zhEntryData.$inferInsert)[];
  zhCharacterData?: (typeof schema.zhCharacterData.$inferInsert)[];
  jaEntryData?: (typeof schema.jaEntryData.$inferInsert)[];
  jaPitchAccents?: (typeof schema.jaPitchAccents.$inferInsert)[];
  jaCharacterData?: (typeof schema.jaCharacterData.$inferInsert)[];
  jaCharacterComponents?: (typeof schema.jaCharacterComponents.$inferInsert)[];
  jaRadicals?: (typeof schema.jaRadicals.$inferInsert)[];
  jaRadicalCharacters?: (typeof schema.jaRadicalCharacters.$inferInsert)[];
}

export interface LoadReport {
  counts: Record<string, number>;
}

export interface LanguageSeeder<Extracted = unknown> {
  languageCode: string;
  dictionaries(ctx: SeedContext): Promise<SeedDictionary[]>;
  prepare(ctx: SeedContext): Promise<void>;
  extract(ctx: SeedContext): Promise<Extracted>;
  validate(payload: Extracted, ctx: SeedContext): Promise<ValidationReport>;
  transform(payload: Extracted, ctx: SeedContext): Promise<NormalizedSeedData>;
  load(data: NormalizedSeedData, ctx: SeedContext): Promise<LoadReport>;
  postProcess(ctx: SeedContext): Promise<void>;
}
