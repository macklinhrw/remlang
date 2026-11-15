import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { RESOURCES_PATH } from "@/scripts/seed/core/db";
import {
  getUnidicCwjPaths,
  UNIDIC_CWJ_DIRNAME,
  UNIDIC_CWJ_DOWNLOADS,
} from "@/scripts/seed/languages/ja/pitchAccent";

const FORCE_FLAG = "--force";

const downloadFile = async (url: string, destinationPath: string) => {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  await pipeline(
    Readable.fromWeb(response.body as any),
    fs.createWriteStream(destinationPath),
  );
};

const main = async () => {
  const force = process.argv.includes(FORCE_FLAG);
  const resourcesDir = path.join(process.cwd(), RESOURCES_PATH);
  const unidicPaths = getUnidicCwjPaths(resourcesDir);

  fs.mkdirSync(unidicPaths.baseDir, { recursive: true });

  for (const spec of UNIDIC_CWJ_DOWNLOADS) {
    const destinationPath = path.join(resourcesDir, UNIDIC_CWJ_DIRNAME, spec.relativePath);
    if (!force && fs.existsSync(destinationPath) && fs.statSync(destinationPath).size > 0) {
      console.log(`skip ${spec.relativePath}`);
      continue;
    }

    console.log(`download ${spec.relativePath}`);
    await downloadFile(spec.url, destinationPath);
  }

  console.log(`saved UniDic resources to ${unidicPaths.baseDir}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
