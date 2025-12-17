#!/usr/bin/env node
/**
 * Git synchronization helper for remote registry repos
 * 
 * Handles cloning, fetching, polling, and caching for MCP Registry
 * when using a remote git repository as the source of server definitions.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

class GitSync {
  /**
   * @param {Object} options
   * @param {string} options.repoUrl - Git repo URL (HTTPS or SSH)
   * @param {string} options.branch - Branch to track
   * @param {number} options.pollInterval - Seconds between update checks
   * @param {string} options.serversPath - Path to servers folder within repo
   * @param {string} options.cloneDir - Where to clone the repo
   */
  constructor(options = {}) {
    this.repoUrl = options.repoUrl || process.env.MCP_REGISTRY_REPO;
    this.branch = options.branch || process.env.MCP_REGISTRY_BRANCH || 'main';
    this.pollInterval = parseInt(process.env.MCP_POLL_INTERVAL) || 300;
    this.serversPath = process.env.MCP_REGISTRY_PATH || 'servers';
    
    // Generate consistent clone dir based on repo URL
    if (this.repoUrl) {
      const hash = crypto.createHash('md5').update(this.repoUrl).digest('hex').slice(0, 8);
      this.cloneDir = process.env.MCP_CLONE_DIR || 
                      path.join(os.tmpdir(), `mcp-registry-${hash}`);
    } else {
      this.cloneDir = null;
    }
    
    this.pollTimer = null;
    this.onUpdate = null;
    this._lastCommitHash = null;
  }

  /**
   * Get the path to the servers directory
   */
  get serversDir() {
    if (!this.cloneDir) return null;
    return path.join(this.cloneDir, this.serversPath);
  }

  /**
   * Check if we're using a remote repository
   */
  get isRemote() {
    return !!this.repoUrl;
  }

  /**
   * Get the current commit hash (for caching)
   */
  get currentCommitHash() {
    return this._lastCommitHash;
  }

  /**
   * Initial clone or fetch if already exists
   * @returns {Promise<boolean>} true if remote repo was initialized
   */
  async initialize() {
    if (!this.repoUrl) {
      console.log('📁 Using local servers/ directory');
      return false;
    }

    console.log(`🔗 Remote repo: ${this.repoUrl}`);
    console.log(`🌿 Branch: ${this.branch}`);
    console.log(`📂 Clone dir: ${this.cloneDir}`);

    try {
      if (fs.existsSync(path.join(this.cloneDir, '.git'))) {
        console.log('📥 Fetching latest changes...');
        this._git('fetch', 'origin', this.branch);
        this._git('reset', '--hard', `origin/${this.branch}`);
      } else {
        console.log('📥 Cloning repository...');
        fs.mkdirSync(this.cloneDir, { recursive: true });
        this._git('clone', '--branch', this.branch, '--single-branch', 
                  '--depth', '1', this.repoUrl, '.');
      }

      // Store current commit hash for caching
      this._lastCommitHash = this._git('rev-parse', 'HEAD').trim();
      console.log(`📌 Current commit: ${this._lastCommitHash.slice(0, 8)}`);

      return true;
    } catch (err) {
      console.error('❌ Git operation failed:', err.message);
      throw err;
    }
  }

  /**
   * Check if remote has new commits
   * @returns {boolean} true if there are new commits
   */
  hasUpdates() {
    if (!this.repoUrl || !this._lastCommitHash) return false;

    try {
      const localHead = this._lastCommitHash;
      this._git('fetch', 'origin', this.branch);
      const remoteHead = this._git('rev-parse', `origin/${this.branch}`).trim();

      const hasChanges = localHead !== remoteHead;
      if (hasChanges) {
        console.log(`🔄 New commits: ${localHead.slice(0, 8)} → ${remoteHead.slice(0, 8)}`);
      }
      return hasChanges;
    } catch (err) {
      console.error('❌ Failed to check for updates:', err.message);
      return false;
    }
  }

  /**
   * Pull latest changes
   * @returns {boolean} true if pull was successful
   */
  pull() {
    if (!this.repoUrl) return false;

    try {
      console.log('📥 Pulling latest changes...');
      this._git('reset', '--hard', `origin/${this.branch}`);
      this._lastCommitHash = this._git('rev-parse', 'HEAD').trim();
      console.log(`📌 Updated to commit: ${this._lastCommitHash.slice(0, 8)}`);
      return true;
    } catch (err) {
      console.error('❌ Pull failed:', err.message);
      return false;
    }
  }

  /**
   * Start polling for changes
   * @param {Function} onUpdate - Callback when updates are detected
   */
  startPolling(onUpdate) {
    if (!this.repoUrl) return;

    this.onUpdate = onUpdate;
    console.log(`⏱️  Polling every ${this.pollInterval}s for changes...`);

    this.pollTimer = setInterval(async () => {
      try {
        if (this.hasUpdates()) {
          console.log('🔄 Remote changes detected!');
          if (this.pull() && this.onUpdate) {
            await this.onUpdate();
          }
        }
      } catch (err) {
        console.error('❌ Poll error:', err.message);
      }
    }, this.pollInterval * 1000);
  }

  /**
   * Stop polling for changes
   */
  stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      console.log('⏹️  Stopped polling');
    }
  }

  /**
   * Force a refresh from remote
   * @returns {boolean} true if there were new changes
   */
  refresh() {
    if (!this.repoUrl) return false;

    const hadUpdates = this.hasUpdates();
    if (hadUpdates) {
      this.pull();
    }
    return hadUpdates;
  }

  /**
   * Execute a git command in the clone directory
   * @private
   */
  _git(...args) {
    const cmd = `git ${args.join(' ')}`;
    return execSync(cmd, { 
      cwd: this.cloneDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
  }
}

/**
 * Cache manager for build outputs
 * Tracks commit hashes to avoid unnecessary rebuilds
 */
class BuildCache {
  constructor(cacheFile) {
    this.cacheFile = cacheFile || path.join(os.tmpdir(), 'mcp-registry-cache.json');
    this._cache = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.cacheFile)) {
        return JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
      }
    } catch (err) {
      console.warn('⚠️  Could not load cache:', err.message);
    }
    return { lastCommit: null, lastBuild: null };
  }

  _save() {
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(this._cache, null, 2));
    } catch (err) {
      console.warn('⚠️  Could not save cache:', err.message);
    }
  }

  /**
   * Check if we need to rebuild based on commit hash
   * @param {string} currentCommit - Current git commit hash
   * @returns {boolean} true if rebuild is needed
   */
  needsRebuild(currentCommit) {
    if (!currentCommit) return true;
    return this._cache.lastCommit !== currentCommit;
  }

  /**
   * Mark a successful build
   * @param {string} commitHash - The commit hash that was built
   */
  markBuilt(commitHash) {
    this._cache.lastCommit = commitHash;
    this._cache.lastBuild = new Date().toISOString();
    this._save();
    console.log(`💾 Build cached for commit ${commitHash?.slice(0, 8) || 'local'}`);
  }

  /**
   * Get cache info
   */
  get info() {
    return { ...this._cache };
  }

  /**
   * Clear the cache
   */
  clear() {
    this._cache = { lastCommit: null, lastBuild: null };
    this._save();
  }
}

module.exports = { GitSync, BuildCache };
