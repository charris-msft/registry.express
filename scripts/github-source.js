#!/usr/bin/env node

/**
 * GitHub Source Module
 * 
 * Fetches MCP server definitions from GitHub repository instead of local filesystem.
 * This ensures the registry only serves what's committed to the main branch.
 */

const GITHUB_API = 'https://api.github.com';
const DEFAULT_OWNER = 'charris-msft';
const DEFAULT_REPO = 'registry.express';
const DEFAULT_BRANCH = 'main';
const SERVERS_PATH = 'servers';

/**
 * Fetch JSON from GitHub API
 * @param {string} url - The API URL
 * @returns {Promise<any>}
 */
async function fetchGitHub(url) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'registry.express-build'
  };

  // Use GitHub token if available (for higher rate limits)
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Recursively find all JSON files in a GitHub directory
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} path - Directory path
 * @param {string} ref - Branch/tag/commit ref
 * @returns {Promise<string[]>} - Array of file paths
 */
async function findJsonFilesOnGitHub(owner, repo, path, ref) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`;
  const contents = await fetchGitHub(url);
  
  const jsonFiles = [];
  
  for (const item of contents) {
    if (item.type === 'dir') {
      // Recursively search subdirectories
      const subFiles = await findJsonFilesOnGitHub(owner, repo, item.path, ref);
      jsonFiles.push(...subFiles);
    } else if (item.type === 'file' && item.name.endsWith('.json')) {
      jsonFiles.push(item.path);
    }
  }
  
  return jsonFiles;
}

/**
 * Fetch and parse a JSON file from GitHub
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} path - File path
 * @param {string} ref - Branch/tag/commit ref
 * @returns {Promise<any>}
 */
async function fetchJsonFile(owner, repo, path, ref) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}?ref=${ref}`;
  const fileInfo = await fetchGitHub(url);
  
  // GitHub returns base64-encoded content
  const content = Buffer.from(fileInfo.content, 'base64').toString('utf-8');
  return JSON.parse(content);
}

/**
 * Load and validate a server JSON file from GitHub
 * Supports both single server format and multi-server format (servers array)
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} filePath - File path
 * @param {string} ref - Branch/tag/commit ref
 * @returns {Promise<Array>}
 */
async function loadServerFileFromGitHub(owner, repo, filePath, ref) {
  const data = await fetchJsonFile(owner, repo, filePath, ref);

  // Check if it's a multi-server file (has "servers" array)
  if (data.servers && Array.isArray(data.servers)) {
    // Validate each server in the array
    for (const server of data.servers) {
      validateServer(server, filePath);
    }
    return data.servers;
  }

  // Single server format - check for flat structure (official schema) or versioned structure
  if (data.name && data.description) {
    // Flat structure (official MCP schema with top-level version)
    if (data.version && data.packages) {
      // Convert flat structure to internal versioned format
      return [{
        name: data.name,
        title: data.title,
        description: data.description,
        repository: data.repository,
        websiteUrl: data.websiteUrl,
        versions: [{
          version: data.version,
          isLatest: true,
          packages: data.packages
        }]
      }];
    }
    // Versioned structure (internal format)
    if (data.versions) {
      validateServer(data, filePath);
      return [data];
    }
  }

  throw new Error(`Invalid server file ${filePath}: missing required fields (name, description, version/versions)`);
}

/**
 * Validate a server object
 * @param {object} server - Server object to validate
 * @param {string} filePath - File path for error messages
 */
function validateServer(server, filePath) {
  if (!server.name || !server.description) {
    throw new Error(`Invalid server in ${filePath}: missing required fields (name or description)`);
  }
  // Allow either versions array or top-level version + packages
  if (!server.versions && !(server.version && server.packages)) {
    throw new Error(`Invalid server in ${filePath}: missing versions array or version+packages`);
  }
}

/**
 * Fetch all servers from GitHub
 * @param {Object} options - Options
 * @param {string} options.owner - Repository owner (default: charris-msft)
 * @param {string} options.repo - Repository name (default: registry.express)
 * @param {string} options.branch - Branch name (default: main)
 * @param {string} options.path - Servers directory path (default: servers)
 * @returns {Promise<Array>} - Array of server objects
 */
export async function fetchServersFromGitHub(options = {}) {
  const owner = options.owner || process.env.GITHUB_OWNER || DEFAULT_OWNER;
  const repo = options.repo || process.env.GITHUB_REPO || DEFAULT_REPO;
  const branch = options.branch || process.env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const path = options.path || SERVERS_PATH;

  console.log(`📡 Fetching servers from GitHub: ${owner}/${repo}@${branch}/${path}`);

  // Find all JSON files
  const jsonFiles = await findJsonFilesOnGitHub(owner, repo, path, branch);
  console.log(`   Found ${jsonFiles.length} JSON file(s)`);

  // Load all servers
  const servers = [];
  for (const file of jsonFiles) {
    try {
      const loadedServers = await loadServerFileFromGitHub(owner, repo, file, branch);
      for (const server of loadedServers) {
        servers.push(server);
        console.log(`   ✓ ${server.name}`);
      }
    } catch (err) {
      console.error(`   ✗ ${file}: ${err.message}`);
    }
  }

  return servers;
}

// Export for use in build script
export { DEFAULT_OWNER, DEFAULT_REPO, DEFAULT_BRANCH };
