import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const sha256File = async (filePath: string) => {
	const hash = createHash("sha256");
	await pipeline(fs.createReadStream(filePath), hash);
	return hash.digest("hex");
};

/** Git's blob id for a file's contents: sha1("blob <len>\0" + bytes). */
export const gitBlobSha = (contents: Buffer) =>
	createHash("sha1")
		.update(`blob ${contents.length}\0`)
		.update(contents)
		.digest("hex");

/**
 * Digest of a flat directory: sha256 over sorted `"<name> <git blob sha>\n"`
 * lines. Using git blob ids means the expected value can be checked against
 * the upstream repo's tree (GitHub API) without downloading anything.
 */
export const treeDigest = (dir: string) => {
	const names = fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
	const hash = createHash("sha256");
	for (const name of names) {
		hash.update(`${name} ${gitBlobSha(fs.readFileSync(path.join(dir, name)))}\n`);
	}
	return { files: names.length, digest: hash.digest("hex") };
};

export class ChecksumError extends Error {}

/**
 * Stream `url` to `destination`, hashing on the way. The file is written to a
 * `.part` sibling and only renamed into place once size and sha256 match.
 */
export const downloadVerified = async (
	url: string,
	destination: string,
	expected: { sha256?: string; bytes?: number },
	onProgress?: (receivedBytes: number) => void,
) => {
	const response = await fetch(url, { redirect: "follow" });
	if (!response.ok || !response.body) {
		throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`);
	}

	fs.mkdirSync(path.dirname(destination), { recursive: true });
	const partial = `${destination}.part`;
	const hash = createHash("sha256");
	let received = 0;
	const meter = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			hash.update(chunk);
			received += chunk.length;
			onProgress?.(received);
			callback(null, chunk);
		},
	});

	await pipeline(Readable.fromWeb(response.body as never), meter, fs.createWriteStream(partial));
	const actual = hash.digest("hex");

	if (expected.bytes !== undefined && received !== expected.bytes) {
		fs.rmSync(partial, { force: true });
		throw new ChecksumError(`${url}: expected ${expected.bytes} bytes, got ${received}`);
	}
	if (expected.sha256 && actual !== expected.sha256) {
		fs.rmSync(partial, { force: true });
		throw new ChecksumError(`${url}: sha256 ${actual} does not match pinned ${expected.sha256}`);
	}
	fs.renameSync(partial, destination);
	return { sha256: actual, bytes: received };
};

/** Cheap reachability check: HEAD (falling back to a 1-byte ranged GET). */
export const probeUrl = async (url: string) => {
	// identity: otherwise CDNs report the gzip-compressed Content-Length.
	const headers = { "Accept-Encoding": "identity" };
	let response = await fetch(url, { method: "HEAD", headers, redirect: "follow" });
	if (response.status === 405 || response.status === 403) {
		response = await fetch(url, { headers: { ...headers, Range: "bytes=0-0" }, redirect: "follow" });
		await response.body?.cancel();
	}
	const length = response.headers.get("content-length");
	return {
		ok: response.ok,
		status: response.status,
		bytes: length && response.status !== 206 ? Number(length) : undefined,
	};
};

export const run = (command: string, args: string[]) =>
	new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
		child.on("error", (error: NodeJS.ErrnoException) =>
			reject(
				error.code === "ENOENT"
					? new Error(`\`${command}\` is required but was not found on PATH.`)
					: error,
			),
		);
		child.on("close", (code) =>
			code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)),
		);
	});
