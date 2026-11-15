import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gitBlobSha, treeDigest } from "./download";
import { SOURCES } from "./sources";

test("gitBlobSha matches `git hash-object`", () => {
	// printf 'hello\n' | git hash-object --stdin
	assert.equal(gitBlobSha(Buffer.from("hello\n")), "ce013625030ba8dba906f756967f9e9ca394464a");
	assert.equal(gitBlobSha(Buffer.alloc(0)), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
});

test("treeDigest is order-independent and ignores subdirectories", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tree-digest-"));
	try {
		fs.writeFileSync(path.join(dir, "b.svg"), "b");
		fs.writeFileSync(path.join(dir, "a.svg"), "a");
		fs.mkdirSync(path.join(dir, "nested"));
		const first = treeDigest(dir);
		assert.equal(first.files, 2);
		fs.writeFileSync(path.join(dir, "a.svg"), "changed");
		assert.notEqual(treeDigest(dir).digest, first.digest);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("source manifest has unique ids, unique outputs and well-formed digests", () => {
	const ids = SOURCES.map((source) => source.id);
	assert.equal(new Set(ids).size, ids.length);

	const outputs = SOURCES.flatMap((source) => {
		switch (source.kind) {
			case "file":
			case "xz":
				return [source.output.path];
			case "tgz":
				return source.outputs.map((output) => output.path);
			case "github-tarball":
				return source.dirs.map((dir) => dir.to);
		}
	});
	assert.equal(new Set(outputs).size, outputs.length);

	const digests = JSON.stringify(SOURCES).match(/"(sha256|treeDigest)":"[^"]*"/g) ?? [];
	assert.ok(digests.length > 20);
	for (const entry of digests) assert.match(entry, /"[0-9a-f]{64}"$/);
});
