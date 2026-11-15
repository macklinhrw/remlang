import { openSeedDatabase } from "@/scripts/seed/core/db";

const printUsageAndExit = () => {
  console.log("Usage: pnpm inspect:ja-pitch-accent -- <term> [more terms]");
  process.exit(1);
};

const main = () => {
  const terms = process.argv.slice(2).filter(Boolean);
  if (terms.length === 0) printUsageAndExit();

  const { sqlite } = openSeedDatabase();
  try {
    const candidateEntriesStmt = sqlite.prepare(`
      select distinct e.id as entryId, e.canonical_form as canonicalForm, e.canonical_reading as canonicalReading
      from entries e
      left join entry_forms ef on ef.entry_id = e.id
      left join entry_readings er on er.entry_id = e.id
      where e.language_id = 'lang_ja'
        and (
          e.canonical_form = @term
          or e.canonical_reading = @term
          or ef.text = @term
          or er.text = @term
        )
      order by e.canonical_form asc, e.canonical_reading asc, e.id asc
    `);

    const formsStmt = sqlite.prepare(`
      select text, script, form_type as formType, is_primary as isPrimary
      from entry_forms
      where entry_id = ?
      order by is_primary desc, raw_rank asc, text asc
    `);
    const readingsStmt = sqlite.prepare(`
      select text, system, script, is_primary as isPrimary
      from entry_readings
      where entry_id = ?
      order by is_primary desc, raw_rank asc, text asc
    `);
    const glossesStmt = sqlite.prepare(`
      select sg.text as gloss, es.sense_order as senseOrder, sg.gloss_order as glossOrder
      from entry_senses es
      join sense_glosses sg on sg.sense_id = es.id
      where es.entry_id = ?
      order by es.sense_order asc, sg.gloss_order asc
      limit 8
    `);
    const pitchStmt = sqlite.prepare(`
      select
        d.name as dictionaryName,
        jpa.dictionary_id as dictionaryId,
        surface_form as surfaceForm,
        reading,
        pronunciation,
        accent_number as accentNumber,
        accent_order as accentOrder,
        accent_pattern as accentPattern,
        match_type as matchType,
        raw_accent_type as rawAccentType,
        raw_accent_con_type as rawAccentConType,
        raw_accent_mod_type as rawAccentModType,
        source_lexeme_id as sourceLexemeId,
        source_lemma_id as sourceLemmaId
      from ja_pitch_accents jpa
      left join dictionaries d on d.id = jpa.dictionary_id
      where entry_id = ?
      order by surface_form asc, reading asc, accent_order asc, accent_number asc
    `);

    for (const term of terms) {
      console.log(`\n=== ${term} ===`);
      const entries = candidateEntriesStmt.all({ term }) as {
        entryId: string;
        canonicalForm: string | null;
        canonicalReading: string | null;
      }[];

      if (entries.length === 0) {
        console.log("No matching Japanese entries.");
        continue;
      }

      for (const entry of entries) {
        console.log(`\n${entry.entryId}`);
        console.log(`  canonical: ${entry.canonicalForm ?? "-"} [${entry.canonicalReading ?? "-"}]`);

        const forms = formsStmt.all(entry.entryId) as {
          text: string;
          script: string | null;
          formType: string | null;
          isPrimary: number | null;
        }[];
        const readings = readingsStmt.all(entry.entryId) as {
          text: string;
          system: string | null;
          script: string | null;
          isPrimary: number | null;
        }[];
        const glosses = glossesStmt.all(entry.entryId) as {
          gloss: string;
          senseOrder: number;
          glossOrder: number;
        }[];
        const pitchRows = pitchStmt.all(entry.entryId) as {
          dictionaryName: string | null;
          dictionaryId: string | null;
          surfaceForm: string;
          reading: string;
          pronunciation: string | null;
          accentNumber: number;
          accentOrder: number;
          accentPattern: string | null;
          matchType: string;
          rawAccentType: string;
          rawAccentConType: string | null;
          rawAccentModType: string | null;
          sourceLexemeId: string | null;
          sourceLemmaId: string | null;
        }[];

        console.log("  forms:");
        for (const form of forms) {
          console.log(
            `    ${form.text} script=${form.script ?? "-"} type=${form.formType ?? "-"} primary=${form.isPrimary ? "y" : "n"}`,
          );
        }

        console.log("  readings:");
        for (const reading of readings) {
          console.log(
            `    ${reading.text} system=${reading.system ?? "-"} script=${reading.script ?? "-"} primary=${reading.isPrimary ? "y" : "n"}`,
          );
        }

        console.log("  glosses:");
        for (const gloss of glosses) {
          console.log(`    [${gloss.senseOrder}.${gloss.glossOrder}] ${gloss.gloss}`);
        }

        console.log("  pitch accents:");
        if (pitchRows.length === 0) {
          console.log("    none");
        } else {
          for (const pitchRow of pitchRows) {
            console.log(
              `    source=${pitchRow.dictionaryName ?? pitchRow.dictionaryId ?? "-"} ${pitchRow.surfaceForm} [${pitchRow.reading}] accent=${pitchRow.accentNumber} order=${pitchRow.accentOrder} pattern=${pitchRow.accentPattern ?? "-"} match=${pitchRow.matchType} raw=${pitchRow.rawAccentType} pron=${pitchRow.pronunciation ?? "-"} lid=${pitchRow.sourceLexemeId ?? "-"} lemma=${pitchRow.sourceLemmaId ?? "-"}`,
            );
          }
        }
      }
    }
  } finally {
    sqlite.close();
  }
};

main();
