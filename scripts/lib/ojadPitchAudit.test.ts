import assert from "node:assert/strict";
import test from "node:test";
import {
  compareLocalPitchAgainstOjad,
  parseOjadSearchHtml,
} from "@/scripts/lib/ojadPitchAudit";
import { parseAuditArgs } from "@/scripts/audit-ja-pitch-accent-import";

const OJAD_FIXTURE_HTML = `
<!DOCTYPE html>
<html>
  <body>
    <table id="word_table">
      <tbody>
        <tr id="word_11875">
          <td class="midashi">
            <div class="midashi_wrapper">
              <p class="midashi_word">碌</p>
            </div>
          </td>
          <td class="katsuyo katsuyo_jisho_js">
            <div class="katsuyo_proc">
              <p>
                <span class="katsuyo_accent">
                  <span class="accented_word">
                    <span class="mola_-2"><span class="inner"><span class="char">ろ</span></span></span>
                    <span class="accent_plain mola_-1"><span class="inner"><span class="char">く</span></span></span>
                  </span>
                </span>
              </p>
            </div>
          </td>
        </tr>
        <tr id="word_11876">
          <td class="midashi">
            <div class="midashi_wrapper">
              <p class="midashi_word">六</p>
            </div>
          </td>
          <td class="katsuyo katsuyo_jisho_js">
            <div class="katsuyo_proc">
              <p>
                <span class="katsuyo_accent">
                  <span class="accented_word">
                    <span class="mola_-2"><span class="inner"><span class="char">ろ</span></span></span>
                    <span class="accent_top mola_-1"><span class="inner"><span class="char">く</span></span></span>
                  </span>
                </span>
              </p>
            </div>
          </td>
        </tr>
        <tr id="word_6601">
          <td class="midashi">
            <div class="midashi_wrapper">
              <p class="midashi_word">歯科</p>
            </div>
          </td>
          <td class="katsuyo katsuyo_jisho_js">
            <div class="katsuyo_proc">
              <p>
                <span class="katsuyo_accent">
                  <span class="accented_word">
                    <span class="accent_top mola_-2"><span class="inner"><span class="char">し</span></span></span>
                    <span class="mola_-1"><span class="inner"><span class="char">か</span></span></span>
                  </span>
                </span>
              </p>
            </div>
            <div class="katsuyo_proc">
              <p>
                <span class="katsuyo_accent">
                  <span class="accented_word">
                    <span class="mola_-2"><span class="inner"><span class="char">し</span></span></span>
                    <span class="accent_top mola_-1"><span class="inner"><span class="char">か</span></span></span>
                  </span>
                </span>
              </p>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>
`;

test("parseOjadSearchHtml extracts headwords and accent numbers from OJAD markup", () => {
  const parsed = parseOjadSearchHtml(OJAD_FIXTURE_HTML);

  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.entries.length, 3);

  const roku = parsed.entries.find((entry) => entry.headword === "六");
  assert.ok(roku);
  assert.deepEqual(
    roku.accentVariants.map((variant) => ({
      reading: variant.reading,
      accentNumber: variant.accentNumber,
    })),
    [{ reading: "ろく", accentNumber: 2 }],
  );

  const shika = parsed.entries.find((entry) => entry.headword === "歯科");
  assert.ok(shika);
  assert.deepEqual(
    shika.accentVariants.map((variant) => variant.accentNumber).sort((left, right) => left - right),
    [1, 2],
  );
});

test("compareLocalPitchAgainstOjad distinguishes matching, reading, accent, and missing cases", () => {
  const lookupResult = {
    lookupTerm: "ろく",
    url: "https://example.test/ojad",
    error: null,
    warnings: [],
    entries: parseOjadSearchHtml(OJAD_FIXTURE_HTML).entries,
  };

  const matching = compareLocalPitchAgainstOjad({
    lookupTerm: "ろく",
    input: {
      canonicalForm: "六",
      canonicalReading: "ろく",
      displayReading: "ろく",
      accentNumbers: [2],
    },
    lookupResult,
  });
  assert.equal(matching.status, "matches");

  const accentMismatch = compareLocalPitchAgainstOjad({
    lookupTerm: "ろく",
    input: {
      canonicalForm: "六",
      canonicalReading: "ろく",
      displayReading: "ろく",
      accentNumbers: [1],
    },
    lookupResult,
  });
  assert.equal(accentMismatch.status, "accent-mismatch");

  const readingMismatch = compareLocalPitchAgainstOjad({
    lookupTerm: "ろく",
    input: {
      canonicalForm: "六",
      canonicalReading: "む",
      displayReading: "む",
      accentNumbers: [1],
    },
    lookupResult,
  });
  assert.equal(readingMismatch.status, "reading-mismatch");

  const missing = compareLocalPitchAgainstOjad({
    lookupTerm: "ろく",
    input: {
      canonicalForm: "猫",
      canonicalReading: "ねこ",
      displayReading: "ねこ",
      accentNumbers: [1],
    },
    lookupResult,
  });
  assert.equal(missing.status, "no-ojad-match");
});

test("parseAuditArgs recognizes --ojad and limit flags while preserving terms", () => {
  const parsed = parseAuditArgs([
    "node",
    "scripts/audit-ja-pitch-accent-import.ts",
    "--ojad",
    "--limit=5",
    "ろく",
    "あめ",
  ]);

  assert.deepEqual(parsed, {
    limit: 5,
    ojad: true,
    terms: ["ろく", "あめ"],
  });
});
