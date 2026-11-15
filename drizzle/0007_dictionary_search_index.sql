CREATE VIRTUAL TABLE IF NOT EXISTS entry_search USING fts5(
	entry_id UNINDEXED,
	language_id UNINDEXED,
	canonical_form,
	canonical_reading,
	forms_text,
	readings_text,
	gloss_text,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '1 2 3 4 5 6'
);

DELETE FROM entry_search;

INSERT INTO entry_search (
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
) glosses ON glosses.entry_id = e.id;
