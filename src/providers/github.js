'use strict';

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

  async listRepositories() {
    const repos = await this.request('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');
    return repos.map((r) => ({
      id: r.full_name,
      name: r.full_name,
      defaultBranch: r.default_branch,
      private: r.private
    }));
  }

  async listBranches(repoId) {
    const branches = await this.request(`/repos/${repoId}/branches?per_page=100`);
    return branches.map((b) => ({ name: b.name }));
  }

  async listPullRequests(repoId) {
    const prs = await this.request(`/repos/${repoId}/pulls?state=open&per_page=100`);
    return prs.map((pr) => ({
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
