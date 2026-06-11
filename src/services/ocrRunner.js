'use strict';

const { spawn } = require('child_process');

/**
 * OcrRunner isolates all interaction with the Alibaba Open Code Review CLI.
 * It is the only review engine in the MVP; no plugin system exists yet.
 *
 * LLM configuration (OCR_LLM_URL, OCR_LLM_TOKEN, OCR_LLM_MODEL,
 * OCR_USE_ANTHROPIC, OCR_LLM_AUTH_HEADER) is passed through environment
 * variables only and never persisted.
 */
class OcrRunner {
  constructor() {
    // jobId -> child process, used for cancellation
    this.running = new Map();
  }

  /**
   * Run `ocr review --from origin/<base> --to <feature> --format json`
   * inside the repository directory.
   */
  run({ jobId, cwd, baseBranch, featureBranch, onLog = () => {} }) {
    return new Promise((resolve, reject) => {
      const args = [
        'review',
        '--from', `origin/${baseBranch}`,
        '--to', featureBranch,
        '--format', 'json'
      ];

      onLog(`OCR started: ocr ${args.join(' ')}`);

      const child = spawn('ocr', args, {
        cwd,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.running.set(jobId, child);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        const line = text.trim();
        if (line) onLog(`[ocr] ${line.slice(0, 2000)}`);
      });

      child.on('error', (err) => {
        this.running.delete(jobId);
        reject(new Error(`Failed to start OCR CLI: ${err.message}`));
      });

      child.on('close', (exitCode, signal) => {
        this.running.delete(jobId);
        onLog(`OCR finished with exit code ${exitCode}${signal ? ` (signal ${signal})` : ''}`);
        resolve({ exitCode, signal, stdout, stderr });
      });
    });
  }

  /** Best-effort kill of a running OCR process (used for cancellation). */
  kill(jobId) {
    const child = this.running.get(jobId);
    if (!child) return false;
    child.kill('SIGTERM');
    return true;
  }

  /**
   * Try to extract token usage from parsed OCR output.
   *
   * OCR (`ocr review --format json`) reports tokens in the `summary` object:
   *   { "summary": { "total_tokens": N, "input_tokens": N, "output_tokens": N, ... } }
   * (see cmd/opencodereview/output.go in alibaba/open-code-review).
   * Other common locations are checked as a fallback.
   *
   * Returns { inputTokens, outputTokens, totalTokens } or null.
   */
  parseTokenUsage(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const usage =
      parsed.summary ||
      parsed.usage ||
      parsed.token_usage ||
      parsed.tokenUsage ||
      parsed.tokens ||
      parsed.meta?.usage ||
      parsed.stats?.usage;
    if (!usage || typeof usage !== 'object') return null;

    const toInt = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    };

    const inputTokens = toInt(
      usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.promptTokens ?? usage.input
    );
    const outputTokens = toInt(
      usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.completionTokens ?? usage.output
    );
    let totalTokens = toInt(usage.total_tokens ?? usage.totalTokens ?? usage.total);
    if (totalTokens == null && (inputTokens != null || outputTokens != null)) {
      totalTokens = (inputTokens || 0) + (outputTokens || 0);
    }

    if (inputTokens == null && outputTokens == null && totalTokens == null) return null;
    return { inputTokens, outputTokens, totalTokens };
  }

  /** Try to extract the JSON document from OCR stdout. */
  parseOutput(stdout) {
    const text = (stdout || '').trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      // Fall back to the first JSON object/array embedded in the output
      const match = text.match(/[\[{][\s\S]*[\]}]/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

module.exports = new OcrRunner();
