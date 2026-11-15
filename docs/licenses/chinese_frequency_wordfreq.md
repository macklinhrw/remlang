# Chinese Frequency Ranks (wordfreq)

Local seeded file:

- `assets/resources/wordfreq/large_zh.msgpack.gz`

Use in Remlang:

- Chinese search ranking (frequency boost in `lib/database/lexicon.ts`)
- Ordering Chinese homographs, and the "common" badge (rank <= 30,000)

Source:

- wordfreq `3.1.1` by Robyn Speer, file `wordfreq/data/large_zh.msgpack.gz`
- Pinned to commit `42233e6c36ce792031bcccfa17cdd0cec9af5fa7` (tag `v3.2`,
  which declares version 3.1.1 and is byte-identical to the PyPI 3.1.1 wheel)
- <https://github.com/rspeer/wordfreq>

License / reuse terms:

- wordfreq's code is Apache-2.0. Its data files "may be redistributed under a
  Creative Commons Attribution-ShareAlike 4.0 license".
- The Chinese list includes SUBTLEX-CH. wordfreq distributes SUBTLEX with
  permission from Marc Brysbaert on condition that derived work credits the
  SUBTLEX authors and that it stays clear SUBTLEX is freely available data.

Required attribution:

- wordfreq: Robyn Speer. (2022). rspeer/wordfreq: v3.0 (v3.0.2). Zenodo.
  <https://doi.org/10.5281/zenodo.7199437>
- SUBTLEX-CH: Cai, Q., & Brysbaert, M. (2010). SUBTLEX-CH: Chinese word and
  character frequencies based on film subtitles. PLoS One, 5(6), e10729.
  SUBTLEX is freely available at
  <http://crr.ugent.be/programs-data/subtitle-frequencies>.
- The other corpora wordfreq draws on for Chinese (OpenSubtitles 2018,
  Wikipedia, Google Books Ngrams, Jieba's dictionary) are credited in
  wordfreq's README.

How the ranks are derived:

- The seed flattens wordfreq's frequency buckets in order (wordfreq's own
  `iter_wordlist` order) to get a rank per word, matches the words against
  CC-CEDICT simplified headwords, then renumbers the matched primary entries
  1..n. Only that ordering is stored in the database.
- Compared with the unlicensed BCC/BLCU list used in earlier private builds,
  77% of the top 1,000 and 79% of the top 5,000 ranked headwords are shared.
