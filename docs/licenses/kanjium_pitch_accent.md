# Kanjium Pitch Accent Data

Local seeded files:

- `assets/resources/kanjium/accents.txt`
- `assets/resources/kanjium/README.md`
- `assets/resources/kanjium/LICENSE.txt`

Use in Remlang:

- Secondary Japanese pitch-accent import
- Gap-fill source when UniDic does not provide a pitch-accent match

Source:

- Kanjium data package by Uros O.
- Repository root used by the current fetch script:
  <https://raw.githubusercontent.com/mifunetoshiro/kanjium/master>

License / reuse terms:

- The bundled `README.md` states that everything in the package is licensed
  under `CC BY-SA 4.0`.
- The same README also states that much of the database incorporates upstream
  material from `EDRDG`, plus other sources such as Tatoeba, and that usage is
  in conformance with those upstream terms.

Practical attribution note:

- Remlang currently uses only the pitch-accent source file `accents.txt`, as a
  fallback source behind UniDic.
- The local README asks downstream users to attribute the pitch-accent notation
  and related additions to `Uros O.`. That attribution request should remain in
  the repo notes and in any user-facing attribution surface that mentions this
  dataset.

Primary references:

- Local README:
  `assets/resources/kanjium/README.md`
- Local license copy:
  `assets/resources/kanjium/LICENSE.txt`
- <https://creativecommons.org/licenses/by-sa/4.0/>
