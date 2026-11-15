import fs from "fs";
import path from "path";
import { default_enable_fuzz, default_maximum_interval, default_request_retention, default_w } from "ts-fsrs";
import { createFreshSeedDatabase, DB_OUTPUT_PATH, RESOURCES_PATH } from "./core/db";
import { createSeedLogger } from "./core/logger";
import { rebuildEntrySearchIndex } from "./core/searchIndex";
import type { LanguageSeeder, SeedContext } from "./core/types";
import { zhSeeder } from "./languages/zh";
import { jaSeeder } from "./languages/ja";
import * as schema from "@/lib/database/schema";

const availableSeeders: Record<string, LanguageSeeder<any>> = {
  zh: zhSeeder,
  ja: jaSeeder,
};

const seedDefaultFsrsParams = async (ctx: SeedContext) => {
  await ctx.db
    .insert(schema.fsrsParams)
    .values({
      id: "default_params",
      weights: JSON.stringify(default_w),
      requestRetention: default_request_retention,
      maximumInterval: default_maximum_interval,
      enableFuzz: default_enable_fuzz,
      enableShortTerm: true,
      cardLimit: 50,
      lapses: 8,
    })
    .onConflictDoNothing();
};

const getEnabledLanguages = () => {
  const envValue = process.env.SEED_LANGUAGES?.trim();
  if (!envValue) return ["zh", "ja"];
  return envValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
};

const syncPlatformDbAssets = () => {
  const androidDbPath = path.join(
    process.cwd(),
    "android",
    "app",
    "src",
    "main",
    "assets",
    "database.db",
  );
  if (fs.existsSync(path.dirname(androidDbPath)) && fs.existsSync(DB_OUTPUT_PATH)) {
    fs.copyFileSync(DB_OUTPUT_PATH, androidDbPath);
  }
};

export const runSeed = async () => {
  const enabledLanguages = getEnabledLanguages();
  const logger = createSeedLogger("seed");
  logger.info("starting modular seed", { enabledLanguages });

  const { sqlite, db } = createFreshSeedDatabase();
  const ctx: SeedContext = {
    db,
    sqlite,
    rootDir: process.cwd(),
    resourcesDir: RESOURCES_PATH,
    outputDbPath: DB_OUTPUT_PATH,
    enabledLanguages,
    batchSize: 500,
    logger,
  };

  try {
    await seedDefaultFsrsParams(ctx);

    for (const language of enabledLanguages) {
      const seeder = availableSeeders[language];
      if (!seeder) {
        logger.warn("skipping unknown language seeder", { language });
        continue;
      }

      logger.info("running seeder", { language });
      await seeder.prepare(ctx);
      const dictionaryMeta = await seeder.dictionaries(ctx);
      logger.info("registered dictionaries", {
        language,
        count: dictionaryMeta.length,
        slugs: dictionaryMeta.map((dictionary) => dictionary.slug),
      });
      const extracted = await seeder.extract(ctx);
      const validation = await seeder.validate(extracted, ctx);
      if (validation.warnings.length > 0) {
        validation.warnings.forEach((warning) =>
          logger.warn(`validation warning for ${language}`, { warning }),
        );
      }
      if (!validation.valid) {
        throw new Error(`Validation failed for language ${language}`);
      }
      const transformed = await seeder.transform(extracted, ctx);
      const report = await seeder.load(transformed, ctx);
      logger.info("loaded language payload", { language, counts: report.counts });
      await seeder.postProcess(ctx);
    }

    rebuildEntrySearchIndex(ctx);
    syncPlatformDbAssets();
    logger.info("seed finished", { outputDbPath: DB_OUTPUT_PATH });
  } finally {
    sqlite.close();
  }
};
