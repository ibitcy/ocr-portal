-- LLM token usage reported by OCR (nullable: not always available)
ALTER TABLE review_results
  ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS total_tokens INTEGER;
