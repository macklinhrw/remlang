/**
 * Download the prebuilt dictionary database (a GitHub Release asset) into
 * `assets/database.db`, so the app can be built without running the seed.
 *
 *   pnpm fetch:db                      # skip if assets/database.db already matches
 *   pnpm fetch:db --force
 *   pnpm fetch:db --file <db.zst>      # install a local `pnpm db:pack` output instead
 *
 * The release is pinned in scripts/data/db-release.json (written by `pnpm db:pack`).
 * The database is CC BY-SA 4.0 (derived from JMdict, CC-CEDICT, Kanjium and others);
 * the release notes carry the attribution.
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";
import release from "@/scripts/data/db-release.json";
import { DATA_REPO } from "@/scripts/data/sources";
import { downloadVerified, sha256File } from "@/scripts/data/download";
import { DB_OUTPUT_PATH } from "@/scripts/seed/core/db";

type DbRelease = {
	tag: string | null;
	asset: string | null;
	bytes: number | null;
	sha256: string | null;
	dbBytes: number | null;
	dbSha256: string | null;
};

const main = async () => {
	const pinned = release as DbRelease;
	if (!pinned.tag || !pinned.asset || !pinned.sha256 || !pinned.dbSha256) {
		throw new Error(
			"No prebuilt database is pinned in scripts/data/db-release.json yet.\n" +
				"Build it from source instead: `pnpm fetch:resources && pnpm seed`.",
		);
	}

	const dbPath = path.join(process.cwd(), DB_OUTPUT_PATH);
	if (
		!process.argv.includes("--force") &&
		fs.existsSync(dbPath) &&
		fs.statSync(dbPath).size === pinned.dbBytes &&
		(await sha256File(dbPath)) === pinned.dbSha256
	) {
		console.log(`${DB_OUTPUT_PATH} already matches ${pinned.tag}`);
		return;
	}

	const fileFlag = process.argv.indexOf("--file");
	const localFile = fileFlag === -1 ? null : process.argv[fileFlag + 1];
	const compressed = `${dbPath}.zst`;
	if (localFile) {
		fs.copyFileSync(localFile, compressed);
		if ((await sha256File(compressed)) !== pinned.sha256) {
			fs.rmSync(compressed, { force: true });
			throw new Error(`${localFile} does not match the sha256 pinned in db-release.json`);
		}
	} else {
		const url = `https://github.com/${DATA_REPO}/releases/download/${pinned.tag}/${pinned.asset}`;
		console.log(`download ${url}`);
		await downloadVerified(url, compressed, {
			sha256: pinned.sha256,
			bytes: pinned.bytes ?? undefined,
		});
	}

	console.log(`decompress -> ${DB_OUTPUT_PATH}`);
	const partial = `${dbPath}.part`;
	await pipeline(fs.createReadStream(compressed), createZstdDecompress(), fs.createWriteStream(partial));
	const sha = await sha256File(partial);
	if (sha !== pinned.dbSha256) {
		fs.rmSync(partial, { force: true });
		throw new Error(`decompressed database sha256 ${sha} does not match pinned ${pinned.dbSha256}`);
	}
	fs.renameSync(partial, dbPath);
	fs.rmSync(compressed, { force: true });

	// Keep an already-prebuilt Android project in step, as `pnpm seed` does.
	const androidCopy = path.join(process.cwd(), "android/app/src/main/assets", path.basename(dbPath));
	if (fs.existsSync(path.dirname(androidCopy))) fs.copyFileSync(dbPath, androidCopy);

	console.log(`ok ${DB_OUTPUT_PATH} (${pinned.tag})`);
};

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
