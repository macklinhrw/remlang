/**
 * Reader for wordfreq's packed word lists (`large_zh.msgpack.gz`).
 *
 * wordfreq (https://github.com/rspeer/wordfreq) stores each language as a
 * gzipped msgpack "cBpack": element 0 is the header `{format: "cB", version: 1}`
 * and element i (i >= 1) is the list of words whose frequency rounds to -i
 * centibels. Flattening the buckets in order gives the words from most to least
 * frequent, which is exactly wordfreq's own `iter_wordlist` order.
 *
 * Chinese words are stored in wordfreq's "Oversimplified Chinese" (every
 * Traditional character mapped to Simplified), so they match CC-CEDICT's
 * simplified headwords.
 *
 * The data is CC BY-SA 4.0; see THIRD_PARTY.md for the attribution.
 */
import zlib from "node:zlib";

type MsgpackValue = null | boolean | number | string | MsgpackValue[] | { [key: string]: MsgpackValue };

/**
 * Minimal msgpack decoder covering the types wordfreq writes (maps, arrays,
 * strings and small integers). Anything else is rejected rather than guessed.
 */
export const decodeMsgpack = (buffer: Uint8Array): MsgpackValue => {
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const utf8 = new TextDecoder("utf-8", { fatal: true });
	let offset = 0;

	const need = (bytes: number) => {
		if (offset + bytes > buffer.byteLength) throw new Error("msgpack: unexpected end of input");
	};
	const u8 = () => (need(1), view.getUint8(offset++));
	const u16 = () => (need(2), (offset += 2), view.getUint16(offset - 2));
	const u32 = () => (need(4), (offset += 4), view.getUint32(offset - 4));
	const str = (length: number) => {
		need(length);
		const value = utf8.decode(buffer.subarray(offset, offset + length));
		offset += length;
		return value;
	};
	const array = (length: number): MsgpackValue[] => {
		const items: MsgpackValue[] = new Array(length);
		for (let i = 0; i < length; i++) items[i] = read();
		return items;
	};
	const map = (length: number) => {
		const result: { [key: string]: MsgpackValue } = {};
		for (let i = 0; i < length; i++) {
			const key = read();
			if (typeof key !== "string") throw new Error("msgpack: only string map keys are supported");
			result[key] = read();
		}
		return result;
	};

	const read = (): MsgpackValue => {
		const type = u8();
		if (type <= 0x7f) return type;
		if (type <= 0x8f) return map(type & 0x0f);
		if (type <= 0x9f) return array(type & 0x0f);
		if (type <= 0xbf) return str(type & 0x1f);
		if (type >= 0xe0) return type - 0x100;
		switch (type) {
			case 0xc0:
				return null;
			case 0xc2:
				return false;
			case 0xc3:
				return true;
			case 0xcc:
				return u8();
			case 0xcd:
				return u16();
			case 0xce:
				return u32();
			case 0xd0:
				return (need(1), view.getInt8(offset++));
			case 0xd1:
				return (need(2), (offset += 2), view.getInt16(offset - 2));
			case 0xd2:
				return (need(4), (offset += 4), view.getInt32(offset - 4));
			case 0xd9:
				return str(u8());
			case 0xda:
				return str(u16());
			case 0xdb:
				return str(u32());
			case 0xdc:
				return array(u16());
			case 0xdd:
				return array(u32());
			case 0xde:
				return map(u16());
			case 0xdf:
				return map(u32());
			default:
				throw new Error(`msgpack: unsupported type byte 0x${type.toString(16)} at offset ${offset - 1}`);
		}
	};

	const value = read();
	if (offset !== buffer.byteLength) throw new Error("msgpack: trailing bytes after the top-level value");
	return value;
};

/**
 * Parse a wordfreq cBpack into a word -> rank map (1 = most frequent). A word
 * that appears in more than one bucket keeps its best rank.
 */
export const readWordfreqRanks = (packed: Uint8Array): Map<string, number> => {
	const data = decodeMsgpack(zlib.gunzipSync(packed));
	if (!Array.isArray(data)) throw new Error("wordfreq: expected a top-level array");
	const header = data[0];
	if (
		header === null ||
		typeof header !== "object" ||
		Array.isArray(header) ||
		header.format !== "cB" ||
		header.version !== 1
	) {
		throw new Error(`wordfreq: unexpected header ${JSON.stringify(header)}`);
	}

	const ranks = new Map<string, number>();
	let rank = 0;
	for (const bucket of data.slice(1)) {
		if (!Array.isArray(bucket)) throw new Error("wordfreq: expected each frequency bucket to be an array");
		for (const word of bucket) {
			if (typeof word !== "string") throw new Error("wordfreq: expected words to be strings");
			rank += 1;
			if (!ranks.has(word)) ranks.set(word, rank);
		}
	}
	return ranks;
};
