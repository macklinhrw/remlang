export const ENTRY_SEARCH_TABLE = "entry_search";

const SEARCH_INDEX_INSERT_SQL = `
INSERT INTO ${ENTRY_SEARCH_TABLE} (
  entry_id,
  language_id,
  canonical_form,
  canonical_reading,
  forms_text,
  readings_text,
  gloss_text
)
SELECT
  e.id,
  e.language_id,
  COALESCE(e.canonical_form, ''),
  COALESCE(e.canonical_reading, ''),
  COALESCE(forms.forms_text, ''),
  COALESCE(readings.readings_text, ''),
  COALESCE(glosses.gloss_text, '')
FROM entries e
LEFT JOIN (
  SELECT
    entry_id,
    group_concat(text, ' ') AS forms_text
  FROM entry_forms
  GROUP BY entry_id
) forms ON forms.entry_id = e.id
LEFT JOIN (
  SELECT
    entry_id,
    group_concat(text, ' ') AS readings_text
  FROM entry_readings
  GROUP BY entry_id
) readings ON readings.entry_id = e.id
LEFT JOIN (
  SELECT
    es.entry_id,
    group_concat(sg.text, ' ') AS gloss_text
  FROM entry_senses es
  INNER JOIN sense_glosses sg ON sg.sense_id = es.id
  WHERE sg.gloss_language = 'eng'
  GROUP BY es.entry_id
) glosses ON glosses.entry_id = e.id
`;

export const rebuildEntrySearchIndexSql = `
DELETE FROM ${ENTRY_SEARCH_TABLE};
${SEARCH_INDEX_INSERT_SQL}
`;

const escapeFtsToken = (value: string) => `"${value.replace(/"/g, '""')}"`;

export const buildEntrySearchMatchQuery = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  const tokens = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return null;

  return tokens.map((token) => `${escapeFtsToken(token)}*`).join(" AND ");
};
