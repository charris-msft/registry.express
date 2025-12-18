#!/usr/bin/env node

/**
 * Git Configuration Helper
 * 
 * Automatically detects GitHub owner/repo from git remote origin.
 * Falls back to environment variables or defaults.
 */

import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Fallback defaults (used when not in a git repo or remote can't be parsed)
const FALLBACK_OWNER = 'your-username';
const FALLBACK_REPO = 'registry.express';
const FALLBACK_BRANCH = 'main';

/**
 * Parse GitHub owner and repo from a git remote URL
 * Supports: 
 *   - https://github.com/owner/repo.git
 *   - https://github.com/owner/repo
 *   - git@github.com:owner/repo.git
 *   - git@github.com:owner/repo
 */
function parseGitRemote(url) {
  if (!url) return null;
  
  // HTTPS format: https://github.com/owner/repo.git or https://github.com/owner/repo
  const httpsMatch = url.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  
  // SSH format: git@github.com:owner/repo.git or git@github.com:owner/repo
  const sshMatch = url.match(/github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  
  return null;
}

/**
 * Get the git remote origin URL
 */
function getGitRemoteUrl() {
  try {
    const url = execSync('git remote get-url origin', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return url;
  } catch {
    return null;
  }
}

/**
 * Get the current git branch
 */
function getGitBranch() {
  try {
    const branch = execSync('git branch --show-current', {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
    return branch || FALLBACK_BRANCH;
  } catch {
    return FALLBACK_BRANCH;
  }
}

/**
 * Get GitHub configuration from git remote, environment, or defaults
 * Priority: Environment variables > Git remote > Fallback defaults
 */
export function getGitHubConfig() {
  // Check environment variables first (highest priority)
  const envOwner = process.env.GITHUB_OWNER;
  const envRepo = process.env.GITHUB_REPO;
  const envBranch = process.env.GITHUB_BRANCH;
  
  if (envOwner && envRepo) {
    return {
      owner: envOwner,
      repo: envRepo,
      branch: envBranch || FALLBACK_BRANCH,
      source: 'environment'
    };
  }
  
  // Try to detect from git remote
  const remoteUrl = getGitRemoteUrl();
  const parsed = parseGitRemote(remoteUrl);
  
  if (parsed) {
    return {
      owner: envOwner || parsed.owner,
      repo: envRepo || parsed.repo,
      branch: envBranch || getGitBranch() || FALLBACK_BRANCH,
      source: 'git-remote'
    };
  }
  
  // Fall back to defaults
  return {
    owner: envOwner || FALLBACK_OWNER,
    repo: envRepo || FALLBACK_REPO,
    branch: envBranch || FALLBACK_BRANCH,
    source: 'defaults'
  };
}

// Export constants for backwards compatibility
export const DEFAULT_OWNER = getGitHubConfig().owner;
export const DEFAULT_REPO = getGitHubConfig().repo;
export const DEFAULT_BRANCH = getGitHubConfig().branch;

// CLI usage: node git-config.js
if (process.argv[1] && process.argv[1].endsWith('git-config.js')) {
  const config = getGitHubConfig();
  console.log('GitHub Configuration:');
  console.log(`  Owner:  ${config.owner}`);
  console.log(`  Repo:   ${config.repo}`);
  console.log(`  Branch: ${config.branch}`);
  console.log(`  Source: ${config.source}`);
}
