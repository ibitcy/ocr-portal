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
