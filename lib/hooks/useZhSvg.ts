import { observable } from "@legendapp/state";
import { eq } from "drizzle-orm";
import { DrizzleInstance } from "../database/DrizzleContext";
import { jaCharacterData, zhCharacterData } from "../database/schema";

export type CharacterLanguageId = "lang_zh" | "lang_ja";

export type CharacterSvgResult = {
  svg: string | null;
  svgTraditional: string | null;
  svgSpecial: string | null;
};

const buildCacheKey = (languageId: CharacterLanguageId, character: string) => {
  const codePoint = character.codePointAt(0);
  return codePoint ? `${languageId}:${codePoint}` : `${languageId}:${character}`;
};

export const getCharacterSvg = async (
  db: DrizzleInstance,
  character: string,
  languageId: CharacterLanguageId = "lang_zh",
): Promise<CharacterSvgResult | undefined> => {
  const cacheKey = buildCacheKey(languageId, character);
  const svgMap = characterSvgs$.svgMap.get();

  if (cacheKey in svgMap) {
    return svgMap[cacheKey];
  }

  let result: CharacterSvgResult | undefined;

  if (languageId === "lang_ja") {
    const row = await db.query.jaCharacterData.findFirst({
      where: eq(jaCharacterData.character, character),
      columns: {
        svg: true,
      },
    });

    if (row) {
      result = {
        svg: row.svg,
        svgTraditional: null,
        svgSpecial: null,
      };
    }
  } else {
    const row = await db.query.zhCharacterData.findFirst({
      where: eq(zhCharacterData.character, character),
      columns: {
        svgSimplified: true,
        svgSpecial: true,
        svgTraditional: true,
      },
    });

    if (row) {
      result = {
        svg: row.svgSimplified,
        svgTraditional: row.svgTraditional,
        svgSpecial: row.svgSpecial,
      };
    }
  }

  if (result) {
    svgMap[cacheKey] = result;
  }

  return result;
};

export const getZhSvg = async (db: DrizzleInstance, character: string) => {
  const result = await getCharacterSvg(db, character, "lang_zh");
  if (!result) return undefined;

  return {
    svgSimplified: result.svg,
    svgTraditional: result.svgTraditional,
    svgSpecial: result.svgSpecial,
  };
};

interface ICharacterSvgStore {
  svgMap: Record<string, CharacterSvgResult>;
  getCharacterSvg: typeof getCharacterSvg;
}

export const characterSvgs$ = observable<ICharacterSvgStore>({
  svgMap: {},
  getCharacterSvg,
});
