'use strict';

/** Case-insensitive substring match across any of the given fields. */
function matches(search, ...fields) {
  if (!search) return true;
  const q = search.toLowerCase();
  return fields.some((f) => String(f ?? '').toLowerCase().includes(q));
}

/**
 * GitHub / GitHub Enterprise API client.
 * Repository ids are URL-encoded "owner/repo" full names.
 */
class GitHubProvider {
  constructor({ host, token }) {
    this.host = host.replace(/\/+$/, '');
    this.token = token;
    this.apiBase =
      this.host === 'https://github.com' ? 'https://api.github.com' : `${this.host}/api/v3`;
  }

  get name() {
    return 'github';
  }

  async request(path) {
    const res = await fetch(`${this.apiBase}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ocr-portal'
      }
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub API ${res.status} for ${path}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  /** Follows page-based pagination until a short page or maxPages is reached. */
  async requestPaged(path, maxPages) {
    const sep = path.includes('?') ? '&' : '?';
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const items = await this.request(`${path}${sep}per_page=100&page=${page}`);
      all.push(...items);
      if (items.length < 100) break;
    }
    return all;
  }

  async listRepositories(search) {
    const repos = await this.requestPaged(
      '/user/repos?sort=updated&affiliation=owner,collaborator,organization_member',
      search ? 5 : 1
    );
    return repos
      .filter((r) => matches(search, r.full_name))
      .map((r) => ({
        id: r.full_name,
        name: r.full_name,
        defaultBranch: r.default_branch,
        private: r.private
      }));
  }

  // GitHub has no native branch search, so paginate and filter server-side.
  async listBranches(repoId, search) {
    const branches = await this.requestPaged(`/repos/${repoId}/branches`, search ? 10 : 1);
    return branches.filter((b) => matches(search, b.name)).map((b) => ({ name: b.name }));
  }

  async listPullRequests(repoId, search) {
    const prs = await this.requestPaged(`/repos/${repoId}/pulls?state=open`, search ? 3 : 1);
    return prs
      .filter((pr) => matches(search, pr.number, pr.title, pr.head.ref, pr.base.ref))
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        sourceBranch: pr.head.ref,
        targetBranch: pr.base.ref,
        author: pr.user?.login
      }));
  }

  async getPullRequest(repoId, number) {
    const pr = await this.request(`/repos/${repoId}/pulls/${number}`);
    return {
      number: pr.number,
      title: pr.title,
      sourceBranch: pr.head.ref,
      targetBranch: pr.base.ref
    };
  }

  /** Token is embedded only in the in-memory clone URL, never logged. */
  authenticatedCloneUrl(repoName) {
    const url = new URL(`${this.host}/${repoName}.git`);
    url.username = 'x-access-token';
    url.password = this.token;
    return url.toString();
  }
}

module.exports = GitHubProvider;
