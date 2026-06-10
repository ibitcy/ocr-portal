'use strict';

/**
 * GitLab / self-hosted GitLab API client.
 * Repository ids are numeric GitLab project ids.
 */
class GitLabProvider {
  constructor({ host, token }) {
    this.host = host.replace(/\/+$/, '');
    this.token = token;
    this.apiBase = `${this.host}/api/v4`;
  }

  get name() {
    return 'gitlab';
  }

  async request(path) {
    const res = await fetch(`${this.apiBase}${path}`, {
      headers: { 'PRIVATE-TOKEN': this.token }
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitLab API ${res.status} for ${path}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  async listRepositories() {
    const projects = await this.request(
      '/projects?membership=true&per_page=100&order_by=last_activity_at&simple=true'
    );
    return projects.map((p) => ({
      id: String(p.id),
      name: p.path_with_namespace,
      defaultBranch: p.default_branch,
      private: p.visibility !== 'public'
    }));
  }

  async listBranches(repoId) {
    const branches = await this.request(
      `/projects/${encodeURIComponent(repoId)}/repository/branches?per_page=100`
    );
    return branches.map((b) => ({ name: b.name }));
  }

  async listPullRequests(repoId) {
    const mrs = await this.request(
      `/projects/${encodeURIComponent(repoId)}/merge_requests?state=opened&per_page=100`
    );
    return mrs.map((mr) => ({
      number: mr.iid,
      title: mr.title,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      author: mr.author?.username
    }));
  }

  async getPullRequest(repoId, number) {
    const mr = await this.request(
      `/projects/${encodeURIComponent(repoId)}/merge_requests/${number}`
    );
    return {
      number: mr.iid,
      title: mr.title,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch
    };
  }

  /** Token is embedded only in the in-memory clone URL, never logged. */
  authenticatedCloneUrl(repoName) {
    const url = new URL(`${this.host}/${repoName}.git`);
    url.username = 'oauth2';
    url.password = this.token;
    return url.toString();
  }
}

module.exports = GitLabProvider;
