/**
 * Pinned manifest of every raw dataset the seed pipeline reads.
 *
 * Each source names an exact upstream version (release tag, commit SHA or
 * versioned archive path) and the SHA-256 of what lands in `assets/resources/`.
 * `pnpm fetch:resources` downloads, verifies and extracts them; `--check`
 * re-verifies an existing tree offline.
 *
 * Sources with no stable upstream URL (rolling exports, owner-derived files)
 * are served from this repo's `data-sources-v1` GitHub Release instead. They
 * are redistributed there under their original licenses (see LICENSING.md).
 */

export type SourceGroup = "ja" | "zh";

/** A file to verify after the source is fetched. Paths are relative to `assets/resources/`. */
export type OutputFile = { path: string; sha256: string; bytes: number };

/** A directory of files verified by a tree digest (see `treeDigest` in ./download.ts). */
export type OutputTree = { dir: string; files: number; treeDigest: string };

type SourceBase = {
	id: string;
	group: SourceGroup;
	name: string;
	license: string;
	homepage: string;
};

export type Source = SourceBase &
	(
		| {
				/** Plain file download, written as-is. */
				kind: "file";
				url: string;
				output: OutputFile;
		  }
		| {
				/** `.tgz` archive (sha256 pinned) whose members are extracted into `dest`. */
				kind: "tgz";
				url: string;
				archive: { sha256: string; bytes: number };
				dest: string;
				outputs: OutputFile[];
		  }
		| {
				/** Single `.xz`-compressed file (sha256 pinned), decompressed with the `xz` CLI. */
				kind: "xz";
				url: string;
				archive: { sha256: string; bytes: number };
				output: OutputFile;
		  }
		| {
				/**
				 * GitHub source tarball at a pinned commit. Codeload archives are not
				 * byte-stable, so only the extracted directories are verified.
				 */
				kind: "github-tarball";
				repo: string;
				commit: string;
				/** Repo-relative directory -> destination under `assets/resources/`. */
				dirs: { from: string; to: string; tree: OutputTree }[];
		  }
	);

/** GitHub repo hosting the `data-sources-v1` mirror and the prebuilt DB releases. */
export const DATA_REPO = process.env.REMLANG_DATA_REPO?.trim() || "macklinhrw/remlang";
export const MIRROR_TAG = "data-sources-v1";
const mirror = (asset: string) =>
	`https://github.com/${DATA_REPO}/releases/download/${MIRROR_TAG}/${asset}`;

const JMDICT_TAG = "3.6.2+20260323124514";
const jmdict = (asset: string) =>
	`https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(JMDICT_TAG)}/${encodeURIComponent(asset)}`;

const UNIDIC = "https://clrd.ninjal.ac.jp/unidic_archive/cwj/3.1.1/unidic-cwj-3.1.1";
const KANJIUM_COMMIT = "9ebca4589565c696e7c39e089e2e928ad65f678c";
const kanjium = (file: string) =>
	`https://raw.githubusercontent.com/mifunetoshiro/kanjium/${KANJIUM_COMMIT}/${file}`;

const EDRDG = "CC BY-SA 4.0 (EDRDG licence)";

export const SOURCES: Source[] = [
	// ---------------------------------------------------------------- Japanese
	...(
		[
			["jmdict-eng", "JMdict (English)", 11267362, "cb2bc519427f421ac58284533ede59518544497829ff13ba92c164e6bd47ff20", 115814855, "3b88ad24b4faeeb0702f11043ae8fcf3eb766511d85aa6824d7aff5e7a2bfd7b"],
			["jmdict-examples-eng", "JMdict with Tatoeba examples", 13867020, "69fc4b9a8ea8736a00f5434f4bcda4200dc00e91632ac6eb70f6aae86988bfea", 127052818, "673d8b78cd4418b83ddeeb3404a463f3eb5dc04f52d32612ac9328fb19bbb601"],
			["kanjidic2-en", "KANJIDIC2 (English)", 1253360, "04a35315de4e34cca9a1a09ed7ed8667400b7e254f211a0bb0fc9bc35af76938", 14829486, "5afd62f8cc5daaadb073c4878c7ed596cd9238e64e0cda91c2b45ad2700aa4c8"],
			["kradfile", "KRADFILE", 106129, "fae36914efa81298a39d763bed33f7f99bd730b8994e5f8de7d1b2bfe8c0d767", 447522, "90369021899d89159ee6e079bccd7d83915daa3191f0c6ed7efc2473e088c086"],
			["radkfile", "RADKFILE", 134312, "fb90d1446ead5291ae29171f0483b8745b719a1856a0c23a1f7eeff9054f9553", 339960, "ff1f16c9bd7892ae61bd888f68f5cd14383237d2b1eb034f3dd81518c2d7f265"],
		] as const
	).map(
		([id, name, archiveBytes, archiveSha, bytes, sha256]): Source => ({
			id,
			group: "ja",
			name: `${name} via jmdict-simplified ${JMDICT_TAG}`,
			license: EDRDG,
			homepage: "https://github.com/scriptin/jmdict-simplified",
			kind: "tgz",
			url: jmdict(`${id}-${JMDICT_TAG}.json.tgz`),
			archive: { sha256: archiveSha, bytes: archiveBytes },
			dest: "jmdict-simplified",
			outputs: [{ path: `jmdict-simplified/${id}-3.6.2.json`, sha256, bytes }],
		}),
	),
	...(
		[
			["README", 4490, "8b9c0e67caf2b1e838d63dca5a2b7ff34fa8faafe461e942ca1469f90f126e9a"],
			["feature.def", 8715, "b50a047e6caa8a7e4158fa736728e8de46cf009bbe575b239c33312e8b30cd14"],
			["lex_3_1.csv", 233538575, "887bc6dc865d7b839193d03bda50c50f1a36926cb84b567c39ac758da0b8d87d"],
			// Upstream really spells this directory "liceses".
			["liceses/AUTHORS", 34, "d3cde34eb1ec1f6b4b4d78b77d2ff909f812a3c71d451cf97adb48ce7b1b0ab5"],
			["liceses/BSD", 1547, "19ed65bc4230f2c786d955247da91d21f609149accd49715971d14319f97af8d"],
			["liceses/COPYING", 212, "74dcddb9e85ce7ef7066cafae093c680d908f97ee964717da5189643f2cfa740"],
		] as const
	).map(
		([file, bytes, sha256]): Source => ({
			id: `unidic-cwj:${file.replace("liceses/", "licenses/")}`,
			group: "ja",
			name: "UniDic CWJ 3.1.1",
			license: "BSD-3-Clause (UniDic triple licence, BSD option)",
			homepage: "https://clrd.ninjal.ac.jp/unidic/",
			kind: "file",
			url: `${UNIDIC}/${file}`,
			output: {
				path: `unidic-cwj-3.1.1/${file.replace("liceses/", "licenses/")}`,
				sha256,
				bytes,
			},
		}),
	),
	...(
		[
			["data/source_files/raw/accents.txt", "accents.txt", 3226405, "8bd0dd127dab32ceec94cb03ab1ba6b68858ea73421dfa1731af2f373deb4f20"],
			["README.md", "README.md", 9722, "2ca73c9cfbe45f9e49db5ab80d514686a34dbcecde0b95040468c0da8ecde94f"],
			["LICENSE.txt", "LICENSE.txt", 18131, "638cc6f2d958b1add3883e8d5d73e32ae999ecdc0a4b4d1a83994b3d5b8e69e9"],
		] as const
	).map(
		([remote, local, bytes, sha256]): Source => ({
			id: `kanjium:${local}`,
			group: "ja",
			name: `Kanjium @ ${KANJIUM_COMMIT.slice(0, 7)}`,
			license: "CC BY-SA 4.0",
			homepage: "https://github.com/mifunetoshiro/kanjium",
			kind: "file",
			url: kanjium(remote),
			output: { path: `kanjium/${local}`, sha256, bytes },
		}),
	),
	{
		id: "tubelex-ja-310",
		group: "ja",
		name: "TUBELEX Japanese word frequencies (UniDic 3.1.0)",
		license: "BSD-3-Clause",
		homepage: "https://github.com/naist-nlp/tubelex",
		kind: "xz",
		url: "https://raw.githubusercontent.com/naist-nlp/tubelex/7cb5fb36add76b83a266d1967536e1a1d3faa513/frequencies/tubelex-ja-310.tsv.xz",
		archive: {
			sha256: "943766c40d5cd8a0f0e48798db2eece9f2b957ef00a809cc251821a3cd0d303e",
			bytes: 4104812,
		},
		output: {
			path: "tubelex/tubelex-ja-310.tsv",
			sha256: "b5df41a0616d33e7764a9b22aba69b3934ab71f106be9ce82501894bee8199e7",
			bytes: 23082098,
		},
	},
	{
		id: "animcjk-ja",
		group: "ja",
		name: "AnimCJK kanji stroke SVGs",
		license: "Arphic Public License (SVGs)",
		homepage: "https://github.com/parsimonhi/animCJK",
		kind: "github-tarball",
		repo: "parsimonhi/animCJK",
		commit: "46bbd0baa3394c8f13d8b022e03b701af36dc945",
		dirs: [
			{
				from: "svgsJa",
				to: "animCJK/svgsJa",
				tree: {
					dir: "animCJK/svgsJa",
					files: 5753,
					treeDigest: "bd47838db4ca35892736db8324ec74f5ecf17ad5f50258c7cb5a74637d4c8507",
				},
			},
		],
	},

	// ----------------------------------------------------------------- Chinese
	{
		id: "animcjk-zh",
		group: "zh",
		name: "AnimCJK hanzi stroke SVGs",
		license: "Arphic Public License (SVGs)",
		homepage: "https://github.com/parsimonhi/animCJK",
		kind: "github-tarball",
		repo: "parsimonhi/animCJK",
		commit: "f5315fcb371d471b0b1fa71d32a28086578ebfa2",
		dirs: [
			["svgsZhHans", 7391, "c450269cd5c9701daf2f5c0b60906388b87252d25dc816c095418581101f85a8"],
			["svgsZhHant", 649, "1817c9170ca4579e7b13264af65cf0bd2f1f3f398d573e1057516d4d628dd72f"],
			["svgsZhHansSpecial", 19, "c076807b3e8751a350e54d71bf0f087cbba732a66159fab21e5b746bc787bda6"],
		].map(([dir, files, treeDigest]) => ({
			from: dir as string,
			to: `animCJK/${dir}`,
			tree: {
				dir: `animCJK/${dir}`,
				files: files as number,
				treeDigest: treeDigest as string,
			},
		})),
	},
	...(
		[
			// [asset, local path, bytes, sha256, name, license, homepage]
			["cedict_ts.u8", "cedict_ts.u8", 9595717, "12f3ce6172e4052c57b9e1c286f038588d8d22fbe37a4a3b1abe71f7c9343513", "CC-CEDICT (2024-07-10 snapshot)", "CC BY-SA 4.0", "https://www.mdbg.net/chinese/dictionary?page=cc-cedict"],
			["CEDICT_variants_list_with_ratings.json", "CEDICT_variants_list_with_ratings.json", 987141, "475c1ee69f31a58f7646469c688c2948f8c45bd3e9145126d3f32ead89eede7a", "Remlang CC-CEDICT variant ratings", "CC BY-SA 4.0 (CC-CEDICT derivative)", "https://www.mdbg.net/chinese/dictionary?page=cc-cedict"],
			["example-chm-en.tsv", "example-chm-en.tsv", 5797271, "9a748334a661aeedfb446e6f9e834ae8323cee594e65cdd91ab559088d3f827d", "Tatoeba Mandarin-English sentence pairs", "CC BY 2.0 FR", "https://tatoeba.org/en/downloads"],
			["wikimedia-decomposition.tsv", "wikimedia-decomposition.tsv", 725507, "b19970ca7f9d95177051bf98345746f16ce64ea03689605ac4176aebefeab00f", "Wikimedia Commons Chinese characters decomposition", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/Commons:Chinese_characters_decomposition"],
			["hsk-hanzi.csv", "hsk/hanzi.csv", 68638, "f6a9f06cd04de6e4b728a149fffcdf63144b679fa0853df3d667517a4c8b4971", "HSK 3.0 hanzi list", "No open licence (official standard, 2021)", "https://www.chinesetest.cn/HSK"],
			["hsk-1.txt", "hsk/hsk-1.txt", 2968, "3081701aee20cec7b8d8c8f3f5041b667d5ed37810f1f750a708eeafbaa572a1", "HSK 3.0 level 1 words", "No open licence (official standard, 2021)", "https://www.chinesetest.cn/HSK"],
			["hsk-2.txt", "hsk/hsk-2.txt", 4970, "1e9150bd38b18d5ec602d7d9d898c16bd28bfba6a3d4c358b04a3238364a44c7", "HSK 3.0 level 2 words", "No open licence (official standard, 2021)", "https://www.chinesetest.cn/HSK"],
			["hsk-3.txt", "hsk/hsk-3.txt", 6402, "9ccd47f23f8f84d73c84608edfce75d81dee71480244d8929e102ef74e960c8a", "HSK 3.0 level 3 words", "No open licence (official standard, 2021)", "https://www.chinesetest.cn/HSK"],
			["hsk-4.txt", "hsk/hsk-4.txt", 6597, "a1f458ff843a6a39541901046c1508f2ca1443626fc9a3f3cc3c8157672a4bed", "HSK 3.0 level 4 words", "No open licence (official standard, 2021)", "https://www.chinesetest.cn/HSK"],
			["hsk-5.txt", "hsk/hsk-5.txt", 7112, "051d6e691add4a86b8bf91e42490ddb3b775e74bfd15463845cb10b1d6610dc1", "HSK 3.0 level 5 words", "No open licence (official standard, 2021)", "https://www.chinesetest.cn/HSK"],
			["hsk-6.txt", "hsk/hsk-6.txt", 7613, "1a81273a1ae95f41f8a39fcf8fdd1d59ca9cdf7e810894be6dce195670a8b9b8", "HSK 3.0 level 6 words", "No open licence (official standard, 2021)", "https://www.chinesetest.cn/HSK"],
			["hsk-7-9.txt", "hsk/hsk-7-9.txt", 41563, "6d344f9ce169e677a49d1bbb6b8c2c34590863347d2156c85efad9f28f6dc84e", "HSK 3.0 levels 7-9 words", "No open licence (official standard, 2021)", "https://www.chinesetest.cn/HSK"],
		] as const
	).map(
		([asset, local, bytes, sha256, name, license, homepage]): Source => ({
			id: `mirror:${asset}`,
			group: "zh",
			name,
			license,
			homepage,
			kind: "file",
			url: mirror(asset),
			output: { path: local, sha256, bytes },
		}),
	),
];

/**
 * Optional inputs that cannot be redistributed. The seed runs without them;
 * see the README for what degrades.
 */
export const OPTIONAL_LOCAL_INPUTS = [
	{
		path: "rank_freq.json",
		why: "BCC/BLCU Chinese word-frequency list (no open licence). Without it, Chinese entries have no frequency rank: search loses its frequency boost and the 'common' badge is hidden for Chinese words.",
	},
];
