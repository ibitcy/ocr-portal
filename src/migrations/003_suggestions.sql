-- Parsed OCR suggestions with generated unified diffs
ALTER TABLE review_results ADD COLUMN IF NOT EXISTS suggestions_json JSONB;
