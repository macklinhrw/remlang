export type AttributionLink = {
	label: string;
	url: string;
};

export type AttributionItem = {
	id: string;
	name: string;
	role: string;
	license: string;
	notes: string;
	links: AttributionLink[];
};

export type AttributionSection = {
	id: string;
	title: string;
	description: string;
	items: AttributionItem[];
};

export const ATTRIBUTION_SECTIONS: AttributionSection[] = [
	{
		id: "bundled-datasets",
		title: "Bundled Datasets",
		description:
			"These are the primary sources used to build the shipped dictionary, review, and stroke-order data.",
		items: [
			{
				id: "cc-cedict",
				name: "CC-CEDICT",
				role: "Chinese dictionary data",
				license: "CC BY-SA 4.0",
				notes:
					"Used for Chinese entries, readings, definitions, and variant relationships.",
				links: [
					{
						label: "Source",
						url: "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
					},
					{
						label: "License",
						url: "https://creativecommons.org/licenses/by-sa/4.0/",
					},
				],
			},
			{
				id: "jmdict-family",
				name: "JMdict / KANJIDIC2 / KRADFILE / RADKFILE",
				role: "Japanese dictionary, kanji, and component data",
				license: "EDRDG licence terms",
				notes:
					"Used for Japanese entries, example-linked senses, kanji metadata, and component/radical decomposition.",
				links: [
					{
						label: "Source",
						url: "https://github.com/scriptin/jmdict-simplified",
					},
					{
						label: "EDRDG",
						url: "https://www.edrdg.org/",
					},
				],
			},
			{
				id: "tubelex",
				name: "TUBELEX Japanese",
				role: "Japanese frequency ranking",
				license: "BSD-3-Clause",
				notes:
					"Used to rank Japanese dictionary entries by corpus frequency.",
				links: [
					{
						label: "Source",
						url: "https://github.com/naist-nlp/tubelex",
					},
					{
						label: "License",
						url: "https://github.com/naist-nlp/tubelex/blob/main/LICENSE",
					},
				],
			},
			{
				id: "wordfreq-zh",
				name: "wordfreq",
				role: "Chinese frequency ranking",
				license: "CC BY-SA 4.0",
				notes:
					"Used to rank Chinese dictionary entries by word frequency (wordfreq 3.1.1, Robyn Speer). The Chinese list combines several corpora, including SUBTLEX-CH (Cai, Q., & Brysbaert, M. (2010). SUBTLEX-CH: Chinese word and character frequencies based on film subtitles. PLoS One, 5(6), e10729), OpenSubtitles 2018, Wikipedia and Google Books Ngrams.",
				links: [
					{
						label: "Source",
						url: "https://github.com/rspeer/wordfreq",
					},
					{
						label: "SUBTLEX-CH",
						url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0010729",
					},
					{
						label: "License",
						url: "https://creativecommons.org/licenses/by-sa/4.0/",
					},
				],
			},
			{
				id: "unidic-cwj",
				name: "UniDic Contemporary Written Japanese",
				role: "Primary Japanese pitch-accent data",
				license: "BSD-3-Clause",
				notes:
					"Used as the primary source for Japanese pitch-accent import and display. The bundled local BSD file covers redistribution and use in source and binary forms.",
				links: [
					{
						label: "Source",
						url: "https://clrd.ninjal.ac.jp/unidic_archive/cwj/3.1.1/unidic-cwj-3.1.1",
					},
				],
			},
			{
				id: "kanjium-pitch",
				name: "Kanjium",
				role: "Secondary Japanese pitch-accent gap-fill data",
				license: "CC BY-SA 4.0",
				notes:
					"Used only as a fallback pitch-accent source when UniDic does not provide a match. The bundled README attributes the pitch-accent additions and modifications to Uros O.",
				links: [
					{
						label: "Source",
						url: "https://github.com/mifunetoshiro/kanjium",
					},
					{
						label: "License",
						url: "https://creativecommons.org/licenses/by-sa/4.0/",
					},
				],
			},
			{
				id: "animcjk",
				name: "AnimCJK",
				role: "Chinese and Japanese stroke-order SVG data",
				license: "Arphic Public License for kanji/hanzi SVGs; LGPL-3.0-or-later for other project files",
				notes:
					"The app ships kanji and hanzi SVG assets from AnimCJK. The bundled local COPYING file states that SVGs representing kanji or hanzi are redistributable under the Arphic Public License.",
				links: [
					{
						label: "Source",
						url: "https://github.com/parsimonhi/animCJK",
					},
					{
						label: "Local COPYING basis",
						url: "https://github.com/parsimonhi/animCJK/blob/master/licenses/COPYING.txt",
					},
				],
			},
		],
	},
	{
		id: "supplemental-data",
		title: "Supplemental Data",
		description:
			"These additional sources support Chinese tagging, decomposition, and example sentence features.",
		items: [
			{
				id: "wikimedia-decomposition",
				name: "Wikimedia Commons Chinese Characters Decomposition",
				role: "Chinese decomposition metadata",
				license: "CC BY-SA 4.0",
				notes:
					"Used from assets/resources/wikimedia-decomposition.tsv, derived from the Artsakenos CCD TSV table on Wikimedia Commons. Wikimedia Commons page text is available under CC BY-SA 4.0.",
				links: [
					{
						label: "CCD project page",
						url: "https://commons.wikimedia.org/wiki/Commons:Chinese_characters_decomposition",
					},
					{
						label: "CCD TSV page",
						url: "https://commons.wikimedia.org/wiki/User:Artsakenos/CCD-TSV",
					},
					{
						label: "CC BY-SA 4.0",
						url: "https://creativecommons.org/licenses/by-sa/4.0/",
					},
				],
			},
			{
				id: "zh-examples",
				name: "Tatoeba sentence-pair exports",
				role: "Chinese example sentences",
				license: "CC BY 2.0 FR; some sentences also available under CC0 1.0",
				notes:
					"Used from assets/resources/example-chm-en.tsv to populate Chinese example sentences and links. Tatoeba states that textual sentences default to CC BY 2.0 FR, and its downloads page states that exported files are released under CC BY 2.0 FR, with some sentences also available under CC0 1.0.",
				links: [
					{
						label: "Tatoeba Terms of Use",
						url: "https://tatoeba.org/en/terms_of_use",
					},
					{
						label: "Tatoeba Downloads",
						url: "https://tatoeba.org/en/downloads",
					},
					{
						label: "CC BY 2.0 FR",
						url: "https://creativecommons.org/licenses/by/2.0/fr/deed.en",
					},
				],
			},
		],
	},
];
