#!/usr/bin/env node

/**
 * Dynamic MCP Registry Server
 * 
 * Fetches servers from GitHub API at runtime and caches them in memory.
 * No build step required - servers are fetched on startup and refreshed every 5 minutes.
 * 
 * Environment variables:
 *   GITHUB_OWNER    - Repository owner (default: charris-msft)
 *   GITHUB_REPO     - Repository name (default: registry.express)
 *   GITHUB_BRANCH   - Branch to fetch from (default: main)
 *   GITHUB_TOKEN    - GitHub token for higher rate limits (optional)
 *   MCP_PORT        - Server port (default: 3443)
 *   REFRESH_INTERVAL - Cache refresh interval in ms (default: 300000 = 5 min)
 */

import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchServersFromGitHub } from './github-source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'src', 'web');

// Configuration
const PORT = parseInt(process.env.MCP_PORT) || 3443;
const REFRESH_INTERVAL = parseInt(process.env.REFRESH_INTERVAL) || 5 * 60 * 1000; // 5 minutes
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'charris-msft';
const GITHUB_REPO = process.env.GITHUB_REPO || 'registry.express';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

// Schema constants
const OFFICIAL_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';

// In-memory cache
let serverCache = {
  servers: [],
  lastRefresh: null,
  refreshing: false
};

// Static file cache for web assets
const staticFiles = new Map();

/**
 * Load static web assets into memory
 */
function loadStaticFiles() {
  if (!fs.existsSync(WEB_DIR)) return;
  
  const files = fs.readdirSync(WEB_DIR);
  for (const file of files) {
    const filePath = path.join(WEB_DIR, file);
    if (fs.statSync(filePath).isFile()) {
      staticFiles.set('/' + file, {
        content: fs.readFileSync(filePath),
        mimeType: getMimeType(file)
      });
      // Also serve index.html at root
      if (file === 'index.html') {
        staticFiles.set('/', {
          content: fs.readFileSync(filePath),
          mimeType: 'text/html'
        });
      }
    }
  }
  console.log(`📄 Loaded ${staticFiles.size} static files`);
}

/**
 * Get MIME type for a file
 */
function getMimeType(filename) {
  const ext = path.extname(filename);
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml'
  };
  return types[ext] || 'application/octet-stream';
}

/**
 * Transform server to VS Code / Official MCP Registry compatible format
 */
function toVSCodeServerFormat(server, version) {
  const now = new Date().toISOString();
  return {
    server: {
      $schema: OFFICIAL_SCHEMA,
      name: server.name,
      title: server.title,
      description: server.description,
      icons: server.icons,
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
 * Refresh the server cache from GitHub
 */
async function refreshCache() {
  if (serverCache.refreshing) {
    console.log('⏳ Cache refresh already in progress...');
    return;
  }

  serverCache.refreshing = true;
  console.log(`\n🔄 Refreshing server cache from GitHub...`);

  try {
    const servers = await fetchServersFromGitHub({
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      branch: GITHUB_BRANCH
    });

    serverCache.servers = servers;
    serverCache.lastRefresh = new Date();
    console.log(`✅ Cache refreshed: ${servers.length} servers loaded`);
  } catch (err) {
    console.error(`❌ Cache refresh failed: ${err.message}`);
    // Keep old cache on failure
  } finally {
    serverCache.refreshing = false;
  }
}

/**
 * URL-encode a server name
 */
function encodeServerName(name) {
  return encodeURIComponent(name);
}

/**
 * Generate the servers list response
 */
function getServersList() {
  const vsCodeServerList = serverCache.servers.map(server => {
    const latestVersion = server.versions.find(v => v.isLatest) || server.versions[0];
    return toVSCodeServerFormat(server, latestVersion);
  });

  return {
    servers: vsCodeServerList,
    metadata: {
      count: serverCache.servers.length,
      lastRefresh: serverCache.lastRefresh?.toISOString()
    }
  };
}

/**
 * Find a server by name
 */
function findServer(name) {
  return serverCache.servers.find(s => s.name === name);
}

/**
 * Handle API requests
 */
function handleRequest(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `https://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  console.log(`${req.method} ${pathname}`);

  // Static files (web UI)
  if (staticFiles.has(url.pathname)) {
    const file = staticFiles.get(url.pathname);
    res.writeHead(200, { 'Content-Type': file.mimeType });
    res.end(file.content);
    return;
  }

  // Status endpoint
  if (pathname === '/_status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      source: `${GITHUB_OWNER}/${GITHUB_REPO}@${GITHUB_BRANCH}`,
      servers: serverCache.servers.length,
      lastRefresh: serverCache.lastRefresh?.toISOString(),
      nextRefresh: new Date(serverCache.lastRefresh?.getTime() + REFRESH_INTERVAL).toISOString()
    }, null, 2));
    return;
  }

  // Force refresh endpoint
  if (pathname === '/_refresh' && req.method === 'POST') {
    refreshCache().then(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, servers: serverCache.servers.length }));
    });
    return;
  }

  // API: List all servers
  // Match: /v0/servers, /v0.1/servers, /v0/servers/, /v0.1/servers/
  if (/^\/(v0\.1|v0)\/servers\/?$/.test(pathname)) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getServersList(), null, 2));
    return;
  }

  // API: Server versions list or specific version
  // Match: /v0.1/servers/{namespace}/{name}/versions/{version}
  // Server names are like "com.microsoft/azure" so we need to capture namespace/name
  const versionMatch = pathname.match(/^\/(v0\.1|v0)\/servers\/([^/]+)\/([^/]+)\/versions\/([^/]+)\/?$/);
  if (versionMatch) {
    const serverName = `${versionMatch[2]}/${versionMatch[3]}`;
    const versionId = versionMatch[4];
    const server = findServer(serverName);

    if (!server) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server not found', name: serverName }));
      return;
    }

    let version;
    if (versionId === 'latest') {
      version = server.versions.find(v => v.isLatest) || server.versions[0];
    } else {
      version = server.versions.find(v => v.version === versionId);
    }

    if (!version) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Version not found', version: versionId }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(toVSCodeServerFormat(server, version), null, 2));
    return;
  }

  // API: Server versions list
  // Match: /v0.1/servers/{namespace}/{name}/versions
  const versionsMatch = pathname.match(/^\/(v0\.1|v0)\/servers\/([^/]+)\/([^/]+)\/versions\/?$/);
  if (versionsMatch) {
    const serverName = `${versionsMatch[2]}/${versionsMatch[3]}`;
    const server = findServer(serverName);

    if (!server) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server not found', name: serverName }));
      return;
    }

    const response = {
      servers: server.versions.map(v => toVSCodeServerFormat(server, v)),
      metadata: { count: server.versions.length }
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response, null, 2));
    return;
  }

  // 404 for everything else
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found', path: pathname }));
}

/**
 * Load SSL certificates
 */
function loadCertificates() {
  const certPath = path.join(ROOT, 'localhost.pem');
  const keyPath = path.join(ROOT, 'localhost-key.pem');

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.warn('⚠️  SSL certificates not found, using HTTP instead');
    console.warn('   Run: mkcert -install && mkcert localhost');
    return null;
  }

  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  };
}

/**
 * Main entry point
 */
async function main() {
  console.log('🚀 MCP Registry Dynamic Server\n');
  console.log(`   📡 Source: ${GITHUB_OWNER}/${GITHUB_REPO}@${GITHUB_BRANCH}`);
  console.log(`   ⏱️  Refresh: every ${REFRESH_INTERVAL / 1000}s`);
  console.log('');

  // Load static files
  loadStaticFiles();

  // Initial cache load
  await refreshCache();

  // Set up periodic refresh
  setInterval(refreshCache, REFRESH_INTERVAL);

  // Create server (HTTPS if certs available, otherwise HTTP)
  const certs = loadCertificates();
  const server = certs
    ? https.createServer(certs, handleRequest)
    : http.createServer(handleRequest);

  const protocol = certs ? 'https' : 'http';

  server.listen(PORT, () => {
    console.log(`\n🌐 Server running at ${protocol}://localhost:${PORT}`);
    console.log(`\n📌 Endpoints:`);
    console.log(`   GET  /                           - Web UI`);
    console.log(`   GET  /v0.1/servers               - List all servers`);
    console.log(`   GET  /v0.1/servers/{name}/versions/latest - Get server details`);
    console.log(`   GET  /_status                    - Server status`);
    console.log(`   POST /_refresh                   - Force cache refresh`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down...');
    server.close(() => {
      console.log('✅ Server stopped');
      process.exit(0);
    });
  });
}

main().catch(err => {
  console.error('❌ Startup failed:', err);
  process.exit(1);
});
