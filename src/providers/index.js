'use strict';

const config = require('../config');
const GitHubProvider = require('./github');
const GitLabProvider = require('./gitlab');

function createProvider() {
  const { provider, host, token } = config.git;
  switch (provider) {
    case 'github':
      return new GitHubProvider({ host, token });
    case 'gitlab':
      return new GitLabProvider({ host, token });
    default:
      throw new Error(`Unsupported GIT_PROVIDER: ${provider}`);
  }
}

module.exports = { provider: createProvider() };
