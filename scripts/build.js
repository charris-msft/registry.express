#!/usr/bin/env node

/**
 * Build script that aggregates individual server JSON files into
 * the API-compatible format for static hosting.
 *
 * Input:  GitHub repository (default) OR local servers/**\/*.json
 * Output: dist/api/v0.1/servers.json (aggregated list)
 *         dist/api/v0.1/servers/{name}/versions.json (per-server)
 *         dist/api/v0.1/servers/{name}/versions/{version}.json (per-version)
 * 
 * By default, fetches servers from GitHub main branch.
 * Use --local flag to build from local filesystem instead.
 * Use --watch flag for local development with auto-rebuild.
 */

import { readdir, readFile, writeFile, mkdir, cp, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { fetchServersFromGitHub } from './github-source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Allow environment variable overrides for remote repo support
const SERVERS_DIR = process.env.MCP_SERVERS_DIR || join(ROOT, 'servers');
const DIST_DIR = process.env.MCP_DIST_DIR || join(ROOT, 'dist');
const API_DIR = join(DIST_DIR, 'api', 'v0.1');
const API_V0_DIR = join(DIST_DIR, 'v0'); // VS Code compatible API path (v0)
const API_V01_DIR = join(DIST_DIR, 'v0.1'); // VS Code compatible API path (v0.1 - tried first)
const API_ROOT = join(DIST_DIR, 'api');
const WEB_DIR = join(ROOT, 'src', 'web');

// Export paths for use by other modules
export { SERVERS_DIR, DIST_DIR, ROOT };

// Registry metadata
const REGISTRY_VERSION = '0.1.0';
const SCHEMA_VERSION = '2025-10-17';
const OFFICIAL_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json';

/**
 * Recursively find all JSON files in a directory
 */
async function findJsonFiles(dir, files = []) {
  if (!existsSync(dir)) return files;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await findJsonFiles(fullPath, files);
    } else if (entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Load and validate a server JSON file
 * Supports:
 * - Multi-server format (has "servers" array)
 * - Flat official MCP schema (top-level version + packages)
 * - Internal versioned format (versions array with packages)
 */
async function loadServerFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  const data = JSON.parse(content);

  // Check if it's a multi-server file (has "servers" array)
  if (data.servers && Array.isArray(data.servers)) {
    // Validate each server in the array
    const result = [];
    for (const server of data.servers) {
      result.push(normalizeServer(server, filePath));
    }
    return result;
  }

  // Single server format
  return [normalizeServer(data, filePath)];
}

/**
 * Normalize server to internal format (with versions array)
 * Supports both flat schema (version + packages) and versioned schema (versions array)
 */
function normalizeServer(data, filePath) {
  if (!data.name || !data.description) {
    throw new Error(`Invalid server in ${filePath}: missing required fields (name or description)`);
  }

  // Flat official MCP schema (top-level version + packages)
  if (data.version && data.packages && !data.versions) {
    return {
      name: data.name,
      title: data.title,
      description: data.description,
      repository: data.repository,
      websiteUrl: data.websiteUrl,
      icons: data.icons,
      versions: [{
        version: data.version,
        isLatest: true,
        packages: data.packages,
        remotes: data.remotes
      }]
    };
  }

  // Internal versioned format
  if (data.versions && Array.isArray(data.versions)) {
    return data;
  }

  throw new Error(`Invalid server in ${filePath}: missing version+packages or versions array`);
}

/**
 * Transform internal server format to API response format
 */
function toApiServerSummary(server) {
  const latestVersion = server.versions.find(v => v.isLatest) || server.versions[0];
  return {
    name: server.name,
    description: server.description,
    version: latestVersion.version,
    repository: server.repository,
    websiteUrl: server.websiteUrl
  };
}

/**
 * Transform to full server detail with all versions
 */
function toApiServerDetail(server) {
  return {
    name: server.name,
    description: server.description,
    repository: server.repository,
    websiteUrl: server.websiteUrl,
    versions: server.versions.map(v => ({
      version: v.version,
      releaseDate: v.releaseDate,
      isLatest: v.isLatest || false
    }))
  };
}

/**
 * Transform to version detail (matches official API format)
 */
function toApiVersionDetail(server, version) {
  return {
    name: server.name,
    description: server.description,
    repository: server.repository,
    websiteUrl: server.websiteUrl,
    version: version.version,
    releaseDate: version.releaseDate,
    packages: version.packages
  };
}

/**
 * Transform to VS Code / Official MCP Registry compatible format
 * This wraps each server in {server: {...}, _meta: {...}} structure
 */
function toVSCodeServerFormat(server, version) {
  const now = new Date().toISOString();
  return {
    server: {
      $schema: OFFICIAL_SCHEMA,
      name: server.name,
      title: server.title,        // VS Code gallery looks for 'title' first
      description: server.description,
      repository: server.repository,
      version: version.version,
      packages: version.packages,
      remotes: version.remotes,
      websiteUrl: server.websiteUrl
    },
    _meta: {
      'io.modelcontextprotocol.registry/official': {
        status: 'active',
        publishedAt: version.releaseDate ? new Date(version.releaseDate).toISOString() : now,
        updatedAt: now,
        isLatest: version.isLatest || false
      }
    }
  };
}

/**
 * Ensure directory exists
 */
async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

/**
 * Write JSON file with pretty printing
 */
async function writeJson(filePath, data) {
  await ensureDir(dirname(filePath));
  await writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * URL-encode a server name for use in file paths
 * Replace / with %2F to match API convention
 */
function encodeServerName(name) {
  return encodeURIComponent(name);
}

/**
 * Main build function
 * @param {Object} options - Build options
 * @param {string} options.serversDir - Override servers directory (for local builds)
 * @param {string} options.distDir - Override dist directory
 * @param {boolean} options.useGitHub - Fetch servers from GitHub instead of local filesystem
 * @param {string} options.githubOwner - GitHub repository owner
 * @param {string} options.githubRepo - GitHub repository name
 * @param {string} options.githubBranch - GitHub branch name
 * @returns {Promise<{serverCount: number, distDir: string}>}
 */
export async function build(options = {}) {
  // Allow runtime overrides (for programmatic use)
  const useGitHub = options.useGitHub || process.argv.includes('--github');
  const serversDir = options.serversDir || SERVERS_DIR;
  const distDir = options.distDir || DIST_DIR;
  const apiDir = join(distDir, 'api', 'v0.1');
  const apiV0Dir = join(distDir, 'v0');
  const apiV01Dir = join(distDir, 'v0.1');
  const apiRoot = join(distDir, 'api');
  
  console.log('🔨 Building MCP Registry...');
  if (useGitHub) {
    const owner = options.githubOwner || process.env.GITHUB_OWNER || 'charris-msft';
    const repo = options.githubRepo || process.env.GITHUB_REPO || 'registry.express';
    const branch = options.githubBranch || process.env.GITHUB_BRANCH || 'main';
    console.log(`   📡 Source: GitHub (${owner}/${repo}@${branch})`);
  } else {
    console.log(`   📂 Source: ${serversDir}`);
  }
  console.log(`   📦 Output: ${distDir}\n`);

  // Clean dist directory
  if (existsSync(distDir)) {
    await rm(distDir, { recursive: true, force: true });
  }
  await ensureDir(distDir);

  // Load servers from GitHub or local filesystem
  let servers = [];
  
  if (useGitHub) {
    // Fetch servers from GitHub
    servers = await fetchServersFromGitHub({
      owner: options.githubOwner,
      repo: options.githubRepo,
      branch: options.githubBranch
    });
  } else {
    // Find all server files locally
    const serverFiles = await findJsonFiles(serversDir);
    console.log(`📦 Found ${serverFiles.length} server file(s)`);

    // Load all servers
    for (const file of serverFiles) {
      try {
        const loadedServers = await loadServerFile(file);
        for (const server of loadedServers) {
          servers.push(server);
          console.log(`   ✓ ${server.name}`);
        }
      } catch (err) {
        console.error(`   ✗ ${file}: ${err.message}`);
      }
    }
  }

  // Sort by name
  servers.sort((a, b) => a.name.localeCompare(b.name));

  // Generate /api/v0.1/servers.json (list endpoint)
  const serverList = {
    servers: servers.map(toApiServerSummary),
    total: servers.length,
    generated: new Date().toISOString()
  };
  await writeJson(join(apiDir, 'servers.json'), serverList);
  console.log(`\n📄 Generated servers.json (${servers.length} servers)`);

  // Generate VS Code compatible /v0/servers endpoint
  // This matches the official MCP Registry API format
  // For static hosting, we use index.json files that the server can serve as directory defaults
  const vsCodeServerList = [];
  for (const server of servers) {
    const latestVersion = server.versions.find(v => v.isLatest) || server.versions[0];
    vsCodeServerList.push(toVSCodeServerFormat(server, latestVersion));
  }
  const vsCodeResponse = {
    servers: vsCodeServerList,
    metadata: {
      count: servers.length
    }
  };
  // Write to /v0/servers/index.json and /v0.1/servers/index.json
  // VS Code tries v0.1 first, then falls back to v0
  await writeJson(join(apiV0Dir, 'servers', 'index.json'), vsCodeResponse);
  await writeJson(join(apiV01Dir, 'servers', 'index.json'), vsCodeResponse);
  console.log('📄 Generated VS Code compatible /v0/servers and /v0.1/servers endpoints');

  // Generate per-server and per-version files
  for (const server of servers) {
    const encodedName = encodeServerName(server.name);
    const serverDir = join(apiDir, 'servers', encodedName);
    const v0ServerDir = join(apiV0Dir, 'servers', encodedName);
    const v01ServerDir = join(apiV01Dir, 'servers', encodedName);

    // /servers/{name}/versions.json
    await writeJson(
      join(serverDir, 'versions.json'),
      toApiServerDetail(server)
    );

    // /servers/{name}/versions/{version}.json
    for (const version of server.versions) {
      await writeJson(
        join(serverDir, 'versions', `${version.version}.json`),
        toApiVersionDetail(server, version)
      );

      // Also generate VS Code compatible /v0/servers/{name}/versions/{version}
      await writeJson(
        join(v0ServerDir, 'versions', version.version, 'index.json'),
        toVSCodeServerFormat(server, version)
      );
      // And /v0.1/servers/{name}/versions/{version}
      await writeJson(
        join(v01ServerDir, 'versions', version.version, 'index.json'),
        toVSCodeServerFormat(server, version)
      );
    }

    // /servers/{name}/versions/latest.json (symlink to latest version)
    const latestVersion = server.versions.find(v => v.isLatest) || server.versions[0];
    await writeJson(
      join(serverDir, 'versions', 'latest.json'),
      toApiVersionDetail(server, latestVersion)
    );

    // Also generate VS Code compatible /v0/servers/{name}/versions/latest
    await writeJson(
      join(v0ServerDir, 'versions', 'latest', 'index.json'),
      toVSCodeServerFormat(server, latestVersion)
    );
    // And /v0.1/servers/{name}/versions/latest
    await writeJson(
      join(v01ServerDir, 'versions', 'latest', 'index.json'),
      toVSCodeServerFormat(server, latestVersion)
    );

    // Generate /v0/servers/{name}/versions (list all versions for this server)
    const v0VersionsList = {
      servers: server.versions.map(v => toVSCodeServerFormat(server, v)),
      metadata: {
        count: server.versions.length
      }
    };
    await writeJson(join(v0ServerDir, 'versions', 'index.json'), v0VersionsList);
    await writeJson(join(v01ServerDir, 'versions', 'index.json'), v0VersionsList);
  }
  console.log('📄 Generated per-server version files');

  // Copy web assets
  if (existsSync(WEB_DIR)) {
    await cp(WEB_DIR, distDir, { recursive: true });
    console.log('📄 Copied web assets');
  }

  // Copy serve.json for static server configuration
  const serveJsonPath = join(ROOT, 'serve.json');
  if (existsSync(serveJsonPath)) {
    await cp(serveJsonPath, join(distDir, 'serve.json'));
    console.log('📄 Copied serve.json');
  }

  // Copy schemas
  const schemasDir = join(ROOT, 'schemas');
  if (existsSync(schemasDir)) {
    await cp(schemasDir, join(distDir, 'schemas'), { recursive: true });
    console.log('📄 Copied schemas');
  }

  // Generate discovery document (/api/index.json)
  const discoveryDoc = {
    version: REGISTRY_VERSION,
    schemaVersion: SCHEMA_VERSION,
    generated: new Date().toISOString(),
    resources: [
      {
        '@id': 'v0.1/servers.json',
        '@type': 'ServerList/0.1.0',
        comment: 'List of all MCP servers with summaries'
      },
      {
        '@id': 'v0.1/servers/{name}/versions.json',
        '@type': 'ServerVersions/0.1.0',
        comment: 'All versions for a specific server ({name} is URL-encoded)'
      },
      {
        '@id': 'v0.1/servers/{name}/versions/{version}.json',
        '@type': 'ServerVersion/0.1.0',
        comment: 'Details for a specific server version'
      },
      {
        '@id': 'v0.1/servers/{name}/versions/latest.json',
        '@type': 'ServerVersion/0.1.0',
        comment: 'Latest version for a specific server'
      }
    ]
  };
  await writeJson(join(apiRoot, 'index.json'), discoveryDoc);
  console.log('📄 Generated discovery document (api/index.json)');

  // Generate simple HTML index (PEP 503-style)
  await generateSimpleIndex(servers, apiRoot);
  console.log('📄 Generated simple index (api/simple/)');

  console.log(`\n✅ Build complete! Output in ${distDir}`);
  
  // Return build info for programmatic use
  return { serverCount: servers.length, distDir };
}

/**
 * Generate a PEP 503-style simple index for easy browsing
 * @param {Array} servers - Array of server objects
 * @param {string} apiRoot - Path to the API root directory
 */
async function generateSimpleIndex(servers, apiRoot = API_ROOT) {
  const simpleDir = join(apiRoot, 'simple');
  await ensureDir(simpleDir);

  // Root index: list of all server names
  const rootLinks = servers.map(s => {
    const encodedName = encodeServerName(s.name);
    return `    <a href="${encodedName}/">${s.name}</a>`;
  }).join('\n');

  const rootHtml = `<!DOCTYPE html>
<html>
<head><title>MCP Registry - Simple Index</title></head>
<body>
  <h1>MCP Registry</h1>
${rootLinks}
</body>
</html>`;

  await writeFile(join(simpleDir, 'index.html'), rootHtml);

  // Also generate JSON variant (PEP 691-style)
  const rootJson = {
    meta: { 'api-version': '1.0' },
    servers: servers.map(s => ({
      name: s.name,
      url: `${encodeServerName(s.name)}/`
    }))
  };
  await writeJson(join(simpleDir, 'index.json'), rootJson);

  // Per-server index: list of versions
  for (const server of servers) {
    const encodedName = encodeServerName(server.name);
    const serverSimpleDir = join(simpleDir, encodedName);
    await ensureDir(serverSimpleDir);

    const versionLinks = server.versions.map(v => {
      const label = v.isLatest ? `${v.version} (latest)` : v.version;
      return `    <a href="../../v0.1/servers/${encodedName}/versions/${v.version}.json">${label}</a>`;
    }).join('\n');

    const serverHtml = `<!DOCTYPE html>
<html>
<head><title>${server.name} - MCP Registry</title></head>
<body>
  <h1>${server.name}</h1>
  <p>${server.description}</p>
${versionLinks}
</body>
</html>`;

    await writeFile(join(serverSimpleDir, 'index.html'), serverHtml);

    // JSON variant
    const serverJson = {
      meta: { 'api-version': '1.0' },
      name: server.name,
      description: server.description,
      versions: server.versions.map(v => ({
        version: v.version,
        isLatest: v.isLatest || false,
        url: `../../v0.1/servers/${encodedName}/versions/${v.version}.json`
      }))
    };
    await writeJson(join(serverSimpleDir, 'index.json'), serverJson);
  }
}

/**
 * Watch mode
 */
async function watch() {
  const chokidar = await import('chokidar');

  console.log('👀 Watching for changes...\n');
  await build();

  const watcher = chokidar.watch([SERVERS_DIR, WEB_DIR], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300 }
  });

  watcher.on('all', async (event, path) => {
    console.log(`\n🔄 ${event}: ${path}`);
    await build();
  });
}

// Run
const isWatch = process.argv.includes('--watch');
const isLocal = process.argv.includes('--local');

if (isWatch) {
  // Watch mode always uses local filesystem
  watch();
} else {
  // Default: use GitHub. Use --local flag to build from local filesystem
  build({ useGitHub: !isLocal }).catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}
