# Remlang data licence

This file covers the data released alongside the code, not the code itself
(the code is GPL-3.0-or-later).

## Prebuilt dictionary database (`db-*` releases)

The Remlang dictionary database (`database-*.db.zst`) is licensed under the
Creative Commons Attribution-ShareAlike 4.0 International licence
(<https://creativecommons.org/licenses/by-sa/4.0/>). It is an adaptation of the
sources listed in [THIRD_PARTY.md](THIRD_PARTY.md), whose attribution
requirements apply:

- JMdict, KANJIDIC2, KRADFILE and RADKFILE (EDRDG, CC BY-SA 4.0)
- CC-CEDICT (CC BY-SA 4.0)
- Kanjium pitch-accent data (CC BY-SA 4.0): "The pitch accent notation, verb
  particle data, phonetics, homonyms and other additions or modifications to
  EDICT, KANJIDIC or KRADFILE were provided by Uros O. through his free
  database."
- wordfreq 3.1.1 Chinese word frequencies (Robyn Speer, CC BY-SA 4.0),
  including SUBTLEX-CH (Cai & Brysbaert, 2010); only the resulting rank order
  is stored
- Wikimedia Commons Chinese characters decomposition (CC BY-SA 4.0)
- UniDic CWJ 3.1.1 pitch accents (BSD-3-Clause) and TUBELEX Japanese
  frequencies (BSD-3-Clause)
- Example sentences from Tatoeba (CC BY 2.0 FR), for Chinese directly and for
  Japanese through JMdict
- HSK level tags derived from the 2021 official HSK standard (no open licence
  stated)

Stroke-order SVG data inside the database is from AnimCJK and is additionally
subject to the Arphic Public License (text in the repository at
`assets/animCJK/licenses/APL/`).

The database contains no user data: the deck, review and premade-deck tables
ship empty.

## Seed data mirror (`data-sources-v1` release)

These files are redistributed unchanged under their original licences, except
where noted:

| File | Source | Licence |
|---|---|---|
| `cedict_ts.u8` | CC-CEDICT, snapshot 2024-07-10 | CC BY-SA 4.0 |
| `CEDICT_variants_list_with_ratings.json` | Variant ratings derived from CC-CEDICT by Remlang | CC BY-SA 4.0 |
| `example-chm-en.tsv` | Tatoeba Mandarin-English sentence pairs | CC BY 2.0 FR |
| `wikimedia-decomposition.tsv` | Wikimedia Commons Chinese characters decomposition | CC BY-SA 4.0 |
| `hsk-1.txt` ... `hsk-7-9.txt`, `hsk-hanzi.csv` | HSK 3.0 word and hanzi lists (Ministry of Education of the PRC, 2021) | No open licence stated; factual level lists used for tagging |

`SHA256SUMS` lists the checksum of every file; the same values are pinned in
`scripts/data/sources.ts`.
