'use strict';

/** Case-insensitive substring match across any of the given fields. */
function matches(search, ...fields) {
  if (!search) return true;
  const q = search.toLowerCase();
  return fields.some((f) => String(f ?? '').toLowerCase().includes(q));
}

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

  // Projects and branches use GitLab's native `search` parameter.
  async listRepositories(search) {
    const projects = await this.request(
      '/projects?membership=true&per_page=100&order_by=last_activity_at&simple=true' +
        (search ? `&search=${encodeURIComponent(search)}` : '')
    );
    return projects.map((p) => ({
      id: String(p.id),
      name: p.path_with_namespace,
      defaultBranch: p.default_branch,
      private: p.visibility !== 'public'
    }));
  }

  async listBranches(repoId, search) {
    const branches = await this.request(
      `/projects/${encodeURIComponent(repoId)}/repository/branches?per_page=100` +
        (search ? `&search=${encodeURIComponent(search)}` : '')
    );
    return branches.map((b) => ({ name: b.name }));
  }

  // GitLab's MR `search` only covers title/description, so filter locally
  // to also match iid and branch names.
  async listPullRequests(repoId, search) {
    const mrs = await this.request(
      `/projects/${encodeURIComponent(repoId)}/merge_requests?state=opened&per_page=100`
    );
    return mrs
      .filter((mr) => matches(search, mr.iid, mr.title, mr.source_branch, mr.target_branch))
      .map((mr) => ({
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
