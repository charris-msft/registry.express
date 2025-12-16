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
const WEB_DIR = join(ROOT, 'src', 'web');

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

  // Generate per-server and per-version files
  for (const server of servers) {
    const encodedName = encodeServerName(server.name);
    const serverDir = join(API_DIR, 'servers', encodedName);

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
    }

    // /servers/{name}/versions/latest.json (symlink to latest version)
    const latestVersion = server.versions.find(v => v.isLatest) || server.versions[0];
    await writeJson(
      join(serverDir, 'versions', 'latest.json'),
      toApiVersionDetail(server, latestVersion)
    );
  }
  console.log('📄 Generated per-server version files');

  // Copy web assets
  if (existsSync(WEB_DIR)) {
    await cp(WEB_DIR, DIST_DIR, { recursive: true });
    console.log('📄 Copied web assets');
  }

  // Copy schemas
  const schemasDir = join(ROOT, 'schemas');
  if (existsSync(schemasDir)) {
    await cp(schemasDir, join(DIST_DIR, 'schemas'), { recursive: true });
    console.log('📄 Copied schemas');
  }

  console.log('\n✅ Build complete! Output in dist/');
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
