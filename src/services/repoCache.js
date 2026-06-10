'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config');

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          // Strip credentials that may leak through git error messages
          const safe = String(stderr || err.message).replace(/\/\/[^@\s]+@/g, '//***@');
          return reject(new Error(`git ${args[0]} failed: ${safe.slice(0, 1000)}`));
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

/**
 * Repository cache under REPOS_CACHE_DIR (/data/repos/<provider>/<owner>/<repo>).
 * Clones on first use, fetches on subsequent runs. Never re-clones an existing repo.
 */
class RepoCache {
  constructor(provider) {
    this.provider = provider;
  }

  repoDir(repoName) {
    return path.join(config.reposCacheDir, this.provider.name, repoName);
  }

  /**
   * Ensure the repository exists locally and is up to date.
   * Returns the local repository path.
   */
  async ensure(repoName, log = () => {}) {
    const dir = this.repoDir(repoName);
    const cloneUrl = this.provider.authenticatedCloneUrl(repoName);

    if (fs.existsSync(path.join(dir, '.git'))) {
      log(`Repository cache hit: ${dir}, fetching updates`);
      // Refresh the remote URL in case the token changed
      await git(['remote', 'set-url', 'origin', cloneUrl], dir);
      await git(['fetch', '--prune', 'origin'], dir);
      log('Fetch completed');
    } else {
      log(`Repository cache miss, cloning into ${dir}`);
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      await git(['clone', cloneUrl, dir]);
      log('Clone completed');
    }
    return dir;
  }

  /**
   * Check out a local branch tracking origin/<branch> so OCR can diff
   * against the working tree state described in the spec.
   */
  async checkoutBranch(repoName, branch, log = () => {}) {
    const dir = this.repoDir(repoName);
    await git(['checkout', '-B', branch, `origin/${branch}`], dir);
    log(`Checked out branch ${branch}`);
    return dir;
  }
}

module.exports = RepoCache;
