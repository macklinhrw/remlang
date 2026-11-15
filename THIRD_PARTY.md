# Third-party data and assets

Remlang's code is AGPL-3.0-or-later (see [LICENSE](LICENSE)). The dictionary
database and the data it is built from are not covered by the code licence;
each source keeps its own licence, listed below. The prebuilt database
(GitHub Releases, `db-*`) is distributed under CC BY-SA 4.0; see
[DATA-LICENSE.md](DATA-LICENSE.md).

None of these datasets are stored in this repository. `pnpm fetch:resources`
downloads them at pinned versions and checks their SHA-256 (see
[scripts/data/sources.ts](scripts/data/sources.ts)). Sources without a stable
upstream URL are mirrored unchanged, or as noted, in this repository's
`data-sources-v1` release. More detail per source is in
[docs/licenses/](docs/licenses/), and the same list is shown on the in-app
About screen.

## Dictionaries and lexical data

- **JMdict, KANJIDIC2, KRADFILE, RADKFILE**: Electronic Dictionary Research and
  Development Group (EDRDG), used in conformance with the Group's licence
  (CC BY-SA 4.0). <https://www.edrdg.org/edrdg/licence.html>.
  JSON conversion by jmdict-simplified (scriptin), release
  `3.6.2+20260323124514`.
- **CC-CEDICT**: MDBG and contributors, CC BY-SA 4.0.
  <https://www.mdbg.net/chinese/dictionary?page=cc-cedict>. Snapshot
  2024-07-10. The mirrored `CEDICT_variants_list_with_ratings.json` contains
  variant ratings derived from CC-CEDICT by this project (CC BY-SA 4.0).
- **Kanjium**: CC BY-SA 4.0. "The pitch accent notation, verb particle data,
  phonetics, homonyms and other additions or modifications to EDICT, KANJIDIC
  or KRADFILE were provided by Uros O. through his free database."
  <https://github.com/mifunetoshiro/kanjium>
- **UniDic CWJ 3.1.1**: The UniDic Consortium / NINJAL, used under the
  BSD-3-Clause option of its triple licence. <https://clrd.ninjal.ac.jp/unidic/>
- **TUBELEX** (Japanese word frequencies): BSD-3-Clause.
  <https://github.com/naist-nlp/tubelex>
- **wordfreq 3.1.1** (Chinese word frequencies): Robyn Speer, data under
  CC BY-SA 4.0. <https://github.com/rspeer/wordfreq>. Cite as: Robyn Speer.
  (2022). rspeer/wordfreq: v3.0 (v3.0.2). Zenodo.
  <https://doi.org/10.5281/zenodo.7199437>. The Chinese list includes
  **SUBTLEX-CH**: Cai, Q., & Brysbaert, M. (2010). SUBTLEX-CH: Chinese word and
  character frequencies based on film subtitles. PLoS One, 5(6), e10729.
  SUBTLEX is freely available data:
  <http://crr.ugent.be/programs-data/subtitle-frequencies>. wordfreq's other
  Chinese sources (OpenSubtitles 2018, Wikipedia, Google Books Ngrams, the
  Jieba dictionary) are credited in its README.
- **Wikimedia Commons Chinese characters decomposition**: CC BY-SA 4.0.
  <https://commons.wikimedia.org/wiki/Commons:Chinese_characters_decomposition>
- **HSK 3.0 vocabulary and hanzi lists**: from the Chinese Proficiency Grading
  Standards for International Chinese Language Education (Ministry of
  Education of the PRC, 2021). Used for level tags only. No open licence is
  stated; see [docs/licenses/official_hsk_lists.md](docs/licenses/official_hsk_lists.md).

## Example sentences

- **Tatoeba**: <https://tatoeba.org>, CC BY 2.0 FR. Used directly for Chinese
  examples, and for Japanese examples through the Tanaka Corpus in JMdict.

## Stroke order

- **AnimCJK**: Copyright 2016-2025 FM&SH, <https://github.com/parsimonhi/animCJK>.
  The kanji and hanzi SVGs are derived from Arphic PL KaitiM GB / UKai and
  Make Me a Hanzi, and are redistributed under the **Arphic Public License**
  (full text in [assets/animCJK/licenses/APL/](assets/animCJK/licenses/APL/)).
  Other AnimCJK files are LGPL-3.0-or-later. The SVGs are fetched at build time
  and stored inside the database; they are not part of this repository.

## Pitch-accent audit (not shipped)

- **OJAD** is queried only by the optional audit script
  `scripts/audit-ja-pitch-accent-import.ts`. Its terms limit use to education
  and research. No OJAD data is stored in the database or in this repository.

## Not included

- Premade decks built from commercial textbooks are not part of this
  repository or the database. The generator and upload scripts
  (`scripts/generateTobiraDecks.ts`, `backend/src/scripts/uploadTobiraPremades.ts`)
  work on a local copy you supply, and the backend only serves premade decks
  to signed-in users.

## Software

- npm dependencies are listed in `package.json` / `pnpm-lock.yaml` and
  `backend/package.json` / `backend/bun.lock` (MIT, ISC, Apache-2.0, Unlicense).
- `patches/` contains modifications to react-native-reanimated and
  @clerk/expo (both MIT).
