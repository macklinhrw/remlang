/**
 * Download the raw datasets the seed pipeline reads into `assets/resources/`.
 *
 *   pnpm fetch:resources                 # everything (~330 MB download, ~520 MB on disk)
 *   pnpm fetch:resources --only ja       # one language group, or a comma list of source ids
 *   pnpm fetch:resources --check         # verify what is on disk, no network
 *   pnpm fetch:resources --resolve       # check every pinned URL is reachable, no download
 *   pnpm fetch:resources --mirror-dir D  # read mirror assets from a local dir (release staging)
 *
 * Every file is checked against the SHA-256 pinned in scripts/data/sources.ts.
 * Requires `tar`, plus `xz` for TUBELEX (preinstalled on Linux; `brew install xz` on macOS).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RESOURCES_PATH } from "@/scripts/seed/core/db";
import {
	downloadVerified,
	probeUrl,
	run,
	sha256File,
	treeDigest,
} from "@/scripts/data/download";
import {
	MIRROR_TAG,
	type OutputFile,
	type OutputTree,
	SOURCES,
	type Source,
} from "@/scripts/data/sources";

type Options = {
	only: Set<string> | null;
	check: boolean;
	resolve: boolean;
	force: boolean;
	mirrorDir: string | null;
};

const parseArgs = (argv: string[]): Options => {
	const valueOf = (flag: string) => {
		const index = argv.indexOf(flag);
		return index === -1 ? null : (argv[index + 1] ?? null);
	};
	const only = valueOf("--only");
	return {
		only: only ? new Set(only.split(",").map((value) => value.trim())) : null,
		check: argv.includes("--check"),
		resolve: argv.includes("--resolve"),
		force: argv.includes("--force"),
		mirrorDir: valueOf("--mirror-dir"),
	};
};

const resourcesRoot = path.join(process.cwd(), RESOURCES_PATH);
const cacheDir = path.join(resourcesRoot, ".downloads");
const abs = (relative: string) => path.join(resourcesRoot, relative);
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

const selected = (source: Source, options: Options) =>
	!options.only ||
	options.only.has(source.group) ||
	options.only.has(source.id) ||
	options.only.has(source.id.split(":")[0]);

const outputsOf = (source: Source): (OutputFile | OutputTree)[] => {
	switch (source.kind) {
		case "file":
		case "xz":
			return [source.output];
		case "tgz":
			return source.outputs;
		case "github-tarball":
			return source.dirs.map((dir) => dir.tree);
	}
};

/** Returns null when the output is present and matches, otherwise a reason. */
const verifyOutput = async (output: OutputFile | OutputTree): Promise<string | null> => {
	if ("dir" in output) {
		if (!fs.existsSync(abs(output.dir))) return "missing";
		const { files, digest } = treeDigest(abs(output.dir));
		if (files !== output.files) return `expected ${output.files} files, found ${files}`;
		return digest === output.treeDigest ? null : `tree digest ${digest.slice(0, 12)}… differs`;
	}
	if (!fs.existsSync(abs(output.path))) return "missing";
	const size = fs.statSync(abs(output.path)).size;
	if (size !== output.bytes) return `expected ${output.bytes} bytes, found ${size}`;
	const sha = await sha256File(abs(output.path));
	return sha === output.sha256 ? null : `sha256 ${sha.slice(0, 12)}… differs`;
};

const verifySource = async (source: Source) => {
	const problems: string[] = [];
	for (const output of outputsOf(source)) {
		const problem = await verifyOutput(output);
		if (problem) problems.push(`${"dir" in output ? output.dir : output.path}: ${problem}`);
	}
	return problems;
};

const urlsOf = (source: Source) =>
	source.kind === "github-tarball"
		? [`https://codeload.github.com/${source.repo}/tar.gz/${source.commit}`]
		: [source.url];

const fetchToCache = async (url: string, expected: { sha256?: string; bytes?: number }, options: Options) => {
	const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "download");
	const target = path.join(cacheDir, name);
	if (options.mirrorDir && url.includes(`/releases/download/${MIRROR_TAG}/`)) {
		fs.mkdirSync(cacheDir, { recursive: true });
		fs.copyFileSync(path.join(options.mirrorDir, name), target);
		if (expected.sha256 && (await sha256File(target)) !== expected.sha256) {
			throw new Error(`${name} in --mirror-dir does not match its pinned sha256`);
		}
		return target;
	}
	let lastLogged = 0;
	await downloadVerified(url, target, expected, (received) => {
		if (process.stdout.isTTY && received - lastLogged > 10_000_000) {
			lastLogged = received;
			process.stdout.write(`\r    ${mb(received)}${expected.bytes ? ` / ${mb(expected.bytes)}` : ""}`);
		}
	});
	if (process.stdout.isTTY && lastLogged) process.stdout.write("\n");
	return target;
};

const fetchSource = async (source: Source, options: Options) => {
	switch (source.kind) {
		case "file": {
			const cached = await fetchToCache(source.url, source.output, options);
			fs.mkdirSync(path.dirname(abs(source.output.path)), { recursive: true });
			fs.renameSync(cached, abs(source.output.path));
			return;
		}
		case "tgz": {
			const cached = await fetchToCache(source.url, source.archive, options);
			fs.mkdirSync(abs(source.dest), { recursive: true });
			await run("tar", ["-xzf", cached, "-C", abs(source.dest)]);
			fs.rmSync(cached);
			return;
		}
		case "xz": {
			const cached = await fetchToCache(source.url, source.archive, options);
			await run("xz", ["-d", "-f", cached]);
			fs.mkdirSync(path.dirname(abs(source.output.path)), { recursive: true });
			fs.renameSync(cached.replace(/\.xz$/, ""), abs(source.output.path));
			return;
		}
		case "github-tarball": {
			const [url] = urlsOf(source);
			const cached = await fetchToCache(url, {}, options);
			const staging = fs.mkdtempSync(path.join(os.tmpdir(), `${source.id}-`));
			const prefix = `${source.repo.split("/")[1]}-${source.commit}`;
			try {
				await run("tar", [
					"-xzf",
					cached,
					"-C",
					staging,
					...source.dirs.map((dir) => `${prefix}/${dir.from}`),
				]);
				for (const dir of source.dirs) {
					fs.rmSync(abs(dir.to), { recursive: true, force: true });
					fs.mkdirSync(path.dirname(abs(dir.to)), { recursive: true });
					fs.cpSync(path.join(staging, prefix, dir.from), abs(dir.to), { recursive: true });
				}
			} finally {
				fs.rmSync(staging, { recursive: true, force: true });
				fs.rmSync(cached, { force: true });
			}
			return;
		}
	}
};

const main = async () => {
	const options = parseArgs(process.argv.slice(2));
	const sources = SOURCES.filter((source) => selected(source, options));
	if (sources.length === 0) throw new Error("--only matched no sources");

	if (options.resolve) {
		let failures = 0;
		for (const source of sources) {
			for (const url of urlsOf(source)) {
				const probe = await probeUrl(url);
				const expectedBytes =
					source.kind === "file"
						? source.output.bytes
						: source.kind === "github-tarball"
							? undefined
							: source.archive.bytes;
				const sizeOk =
					probe.bytes === undefined || expectedBytes === undefined || probe.bytes === expectedBytes;
				const ok = probe.ok && sizeOk;
				if (!ok) failures += 1;
				console.log(
					`${ok ? "ok  " : "FAIL"} ${source.id.padEnd(44)} ${probe.status}${
						sizeOk ? "" : ` size ${probe.bytes} != ${expectedBytes}`
					}`,
				);
			}
		}
		if (failures) throw new Error(`${failures} source URL(s) did not resolve as pinned`);
		return;
	}

	let failures = 0;
	for (const source of sources) {
		const problems = await verifySource(source);
		if (problems.length === 0 && !options.force) {
			console.log(`ok    ${source.id}`);
			continue;
		}
		if (options.check) {
			failures += 1;
			console.log(`FAIL  ${source.id}\n      ${problems.join("\n      ")}`);
			continue;
		}
		console.log(`fetch ${source.id}  (${source.name}; ${source.license})`);
		await fetchSource(source, options);
		const after = await verifySource(source);
		if (after.length > 0) {
			throw new Error(`${source.id} failed verification after download:\n  ${after.join("\n  ")}`);
		}
	}

	fs.rmSync(cacheDir, { recursive: true, force: true });
	if (failures) throw new Error(`${failures} source(s) failed verification`);
};

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
