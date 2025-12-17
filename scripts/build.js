#!/usr/bin/env node

/**
 * Build script that aggregates individual server JSON files into
 * the API-compatible format for static hosting.
 *
 * Input:  servers/**\/*.json (one file per MCP server)
 * Output: dist/api/v0.1/servers.json (aggregated list)
 *         dist/api/v0.1/servers/{name}/versions.json (per-server)
 *         dist/api/v0.1/servers/{name}/versions/{version}.json (per-version)
 */

import { readdir, readFile, writeFile, mkdir, cp, rm } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SERVERS_DIR = join(ROOT, 'servers');
const DIST_DIR = join(ROOT, 'dist');
const API_DIR = join(DIST_DIR, 'api', 'v0.1');
const API_V0_DIR = join(DIST_DIR, 'v0'); // VS Code compatible API path (v0)
const API_V01_DIR = join(DIST_DIR, 'v0.1'); // VS Code compatible API path (v0.1 - tried first)
const API_ROOT = join(DIST_DIR, 'api');
const WEB_DIR = join(ROOT, 'src', 'web');

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
 * Supports both single server format and multi-server format (servers array)
 */
async function loadServerFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  const data = JSON.parse(content);

  // Check if it's a multi-server file (has "servers" array)
  if (data.servers && Array.isArray(data.servers)) {
    // Validate each server in the array
    for (const server of data.servers) {
      if (!server.name || !server.description || !server.versions) {
        throw new Error(`Invalid server in ${filePath}: missing required fields (name, description, or versions)`);
      }
    }
    return data.servers;
  }

  // Single server format
  if (!data.name || !data.description || !data.versions) {
    throw new Error(`Invalid server file ${filePath}: missing required fields`);
  }

  return [data]; // Return as array for consistent handling
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
 */
async function build() {
  console.log('🔨 Building MCP Registry...\n');

  // Clean dist directory
  if (existsSync(DIST_DIR)) {
    await rm(DIST_DIR, { recursive: true });
  }
  await ensureDir(DIST_DIR);

  // Find all server files
  const serverFiles = await findJsonFiles(SERVERS_DIR);
  console.log(`📦 Found ${serverFiles.length} server file(s)`);

  // Load all servers
  const servers = [];
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

  // Sort by name
  servers.sort((a, b) => a.name.localeCompare(b.name));

  // Generate /api/v0.1/servers.json (list endpoint)
  const serverList = {
    servers: servers.map(toApiServerSummary),
    total: servers.length,
    generated: new Date().toISOString()
  };
  await writeJson(join(API_DIR, 'servers.json'), serverList);
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
  await writeJson(join(API_V0_DIR, 'servers', 'index.json'), vsCodeResponse);
  await writeJson(join(API_V01_DIR, 'servers', 'index.json'), vsCodeResponse);
  console.log('📄 Generated VS Code compatible /v0/servers and /v0.1/servers endpoints');

  // Generate per-server and per-version files
  for (const server of servers) {
    const encodedName = encodeServerName(server.name);
    const serverDir = join(API_DIR, 'servers', encodedName);
    const v0ServerDir = join(API_V0_DIR, 'servers', encodedName);
    const v01ServerDir = join(API_V01_DIR, 'servers', encodedName);

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
    await cp(WEB_DIR, DIST_DIR, { recursive: true });
    console.log('📄 Copied web assets');
  }

  // Copy serve.json for static server configuration
  const serveJsonPath = join(ROOT, 'serve.json');
  if (existsSync(serveJsonPath)) {
    await cp(serveJsonPath, join(DIST_DIR, 'serve.json'));
    console.log('📄 Copied serve.json');
  }

  // Copy schemas
  const schemasDir = join(ROOT, 'schemas');
  if (existsSync(schemasDir)) {
    await cp(schemasDir, join(DIST_DIR, 'schemas'), { recursive: true });
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
  await writeJson(join(API_ROOT, 'index.json'), discoveryDoc);
  console.log('📄 Generated discovery document (api/index.json)');

  // Generate simple HTML index (PEP 503-style)
  await generateSimpleIndex(servers);
  console.log('📄 Generated simple index (api/simple/)');

  console.log('\n✅ Build complete! Output in dist/');
}

/**
 * Generate a PEP 503-style simple index for easy browsing
 */
async function generateSimpleIndex(servers) {
  const simpleDir = join(API_ROOT, 'simple');
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
if (isWatch) {
  watch();
} else {
  build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}
