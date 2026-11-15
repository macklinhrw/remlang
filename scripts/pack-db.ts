/**
 * Maintainer step: compress `assets/database.db` for a GitHub Release and pin it
 * in scripts/data/db-release.json so `pnpm fetch:db` can find it.
 *
 *   pnpm seed && pnpm db:pack           # writes dist-data/database-<YYYYMMDD>.db.zst
 *   gh release create db-<YYYYMMDD> dist-data/database-<YYYYMMDD>.db.zst --notes-file DATA-LICENSE.md
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { constants, createZstdCompress } from "node:zlib";
import { sha256File } from "@/scripts/data/download";
import { DB_OUTPUT_PATH } from "@/scripts/seed/core/db";

const main = async () => {
	const dbPath = path.join(process.cwd(), DB_OUTPUT_PATH);
	if (!fs.existsSync(dbPath)) throw new Error(`${DB_OUTPUT_PATH} not found; run \`pnpm seed\` first.`);

	const level = Number(process.env.ZSTD_LEVEL ?? 19);
	const tag = process.env.DB_TAG ?? `db-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}`;
	const asset = `database-${tag.replace(/^db-/, "")}.db.zst`;
	const outDir = path.join(process.cwd(), "dist-data");
	const outPath = path.join(outDir, asset);
	fs.mkdirSync(outDir, { recursive: true });

	console.log(`compress ${DB_OUTPUT_PATH} (zstd level ${level}) -> dist-data/${asset}`);
	await pipeline(
		fs.createReadStream(dbPath),
		createZstdCompress({ params: { [constants.ZSTD_c_compressionLevel]: level } }),
		fs.createWriteStream(outPath),
	);

	const manifest = {
		$comment:
			"Written by `pnpm db:pack`. Read by `pnpm fetch:db`. tag=null means no prebuilt DB has been published yet.",
		tag,
		asset,
		bytes: fs.statSync(outPath).size,
		sha256: await sha256File(outPath),
		dbBytes: fs.statSync(dbPath).size,
		dbSha256: await sha256File(dbPath),
	};
	fs.writeFileSync(
		path.join(process.cwd(), "scripts/data/db-release.json"),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log(JSON.stringify(manifest, null, 2));
	console.log(`\nnext: gh release create ${tag} ${path.relative(process.cwd(), outPath)} --notes-file DATA-LICENSE.md`);
};

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
