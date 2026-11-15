import assert from "node:assert/strict";
import test from "node:test";
import zlib from "node:zlib";
import { decodeMsgpack, readWordfreqRanks } from "./wordfreq";

// Small msgpack encoder for fixtures: picks the smallest encoding, like msgpack-python.
type Value = number | string | Value[] | { [key: string]: Value };
const encode = (value: Value): Buffer => {
	if (typeof value === "number") {
		if (value >= 0 && value <= 0x7f) return Buffer.from([value]);
		if (value >= 0 && value <= 0xffff) return Buffer.from([0xcd, value >> 8, value & 0xff]);
		throw new Error("fixture encoder: unsupported number");
	}
	if (typeof value === "string") {
		const bytes = Buffer.from(value, "utf-8");
		const head =
			bytes.length <= 31 ? Buffer.from([0xa0 | bytes.length]) : Buffer.from([0xd9, bytes.length]);
		return Buffer.concat([head, bytes]);
	}
	if (Array.isArray(value)) {
		const head =
			value.length <= 15
				? Buffer.from([0x90 | value.length])
				: Buffer.from([0xdc, value.length >> 8, value.length & 0xff]);
		return Buffer.concat([head, ...value.map(encode)]);
	}
	const entries = Object.entries(value);
	return Buffer.concat([
		Buffer.from([0x80 | entries.length]),
		...entries.flatMap(([key, item]) => [encode(key), encode(item)]),
	]);
};

const cbpack = (buckets: string[][]) =>
	zlib.gzipSync(encode([{ format: "cB", version: 1 }, ...buckets]));

test("decodeMsgpack reads the encodings wordfreq uses", () => {
	const longWord = "中华人民共和国全国人民代表大会";
	const manyWords = Array.from({ length: 20 }, (_, i) => `w${i}`);
	assert.deepEqual(decodeMsgpack(encode([{ format: "cB", version: 1 }, [longWord], manyWords, 300])), [
		{ format: "cB", version: 1 },
		[longWord],
		manyWords,
		300,
	]);
	assert.equal(decodeMsgpack(Buffer.from([0xc0])), null);
	assert.equal(decodeMsgpack(Buffer.from([0xff])), -1);
	assert.equal(decodeMsgpack(Buffer.from([0xd1, 0xff, 0x38])), -200);
});

test("decodeMsgpack rejects truncated input, trailing bytes and unknown types", () => {
	assert.throws(() => decodeMsgpack(Buffer.from([0x92, 0x01])), /unexpected end/);
	assert.throws(() => decodeMsgpack(Buffer.from([0x01, 0x02])), /trailing bytes/);
	assert.throws(() => decodeMsgpack(Buffer.from([0xcb, 0, 0, 0, 0, 0, 0, 0, 0])), /unsupported type/);
});

test("readWordfreqRanks ranks words in bucket order and keeps the best rank", () => {
	const ranks = readWordfreqRanks(cbpack([[], ["的"], ["了", "是"], [], ["中国", "了"]]));
	assert.deepEqual([...ranks], [
		["的", 1],
		["了", 2],
		["是", 3],
		["中国", 4],
	]);
});

test("readWordfreqRanks rejects a file that is not a cBpack", () => {
	assert.throws(
		() => readWordfreqRanks(zlib.gzipSync(encode([{ format: "other", version: 1 }]))),
		/unexpected header/,
	);
});
