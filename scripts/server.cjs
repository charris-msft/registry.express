#!/usr/bin/env node
/**
 * MCP Registry HTTPS server with optional remote git repo support
 * 
 * Environment variables:
 *   MCP_REGISTRY_REPO    - Git repo URL (if not set, uses local servers/)
 *   MCP_REGISTRY_BRANCH  - Branch to track (default: main)
 *   MCP_POLL_INTERVAL    - Seconds between update checks (default: 300)
 *   MCP_REGISTRY_PATH    - Path to servers/ within repo (default: servers)
 *   MCP_WEBHOOK_SECRET   - Secret for validating webhook requests (optional)
 *   MCP_PORT             - Server port (default: 3443)
 * 
 * Usage: 
 *   node scripts/server.cjs [port]
 *   MCP_REGISTRY_REPO=https://github.com/org/registry node scripts/server.cjs
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { GitSync, BuildCache } = require('./git-sync.cjs');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const DEFAULT_PORT = parseInt(process.env.MCP_PORT) || 3443;
const WEBHOOK_SECRET = process.env.MCP_WEBHOOK_SECRET;

// Initialize git sync and build cache
const gitSync = new GitSync();
const buildCache = new BuildCache();

// Track if we're currently building (prevent concurrent builds)
let isBuilding = false;
let lastSuccessfulDistDir = DIST_DIR;

// Load SSL certificates (create with mkcert if they don't exist)
const certPath = path.join(ROOT, 'localhost.pem');
const keyPath = path.join(ROOT, 'localhost-key.pem');

function loadCertificates() {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.error('❌ SSL certificates not found!');
    console.error('Run: mkcert -install && mkcert localhost');
    process.exit(1);
  }
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

const MIME_TYPES = {
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath);
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function resolveFilePath(urlPath, distDir = lastSuccessfulDistDir) {
  // Parse the URL but keep path segments encoded for filesystem lookup
  const pathOnly = urlPath.split('?')[0];
  
  // The URL comes in decoded from Node's http parser, but our filesystem
  // uses URL-encoded folder names (e.g., com.microsoft%2Fazure)
  // We need to re-encode any slashes that are part of server names
  // 
  // Strategy: Try the decoded path first, then try with re-encoded slashes
  // in the server name portion of the path
  
  // Try exact decoded path first
  let filePath = path.join(distDir, pathOnly);
  
  if (fs.existsSync(filePath)) {
    // If it's a directory, try index files
    if (fs.statSync(filePath).isDirectory()) {
      const indexHtml = path.join(filePath, 'index.html');
      if (fs.existsSync(indexHtml)) return indexHtml;
      const indexJson = path.join(filePath, 'index.json');
      if (fs.existsSync(indexJson)) return indexJson;
      return null;
    }
    return filePath;
  }
  
  // Try with .json extension
  let withJson = filePath + '.json';
  if (fs.existsSync(withJson)) return withJson;
  
  // Try with index.json appended
  let withIndex = path.join(filePath, 'index.json');
  if (fs.existsSync(withIndex)) return withIndex;
  
  // For API paths like /v0.1/servers/com.microsoft/azure/versions/latest
  // We need to re-encode the server name part (slashes become %2F)
  const apiMatch = pathOnly.match(/^(\/v0(?:\.1)?\/servers\/)([^/]+\/[^/]+)(\/.*)?$/);
  if (apiMatch) {
    const [, prefix, serverName, suffix = ''] = apiMatch;
    const encodedName = encodeURIComponent(serverName);
    const encodedPath = prefix + encodedName + suffix;
    
    filePath = path.join(distDir, encodedPath);
    
    if (fs.existsSync(filePath)) {
      if (fs.statSync(filePath).isDirectory()) {
        const indexHtml = path.join(filePath, 'index.html');
        if (fs.existsSync(indexHtml)) return indexHtml;
        const indexJson = path.join(filePath, 'index.json');
        if (fs.existsSync(indexJson)) return indexJson;
        return null;
      }
      return filePath;
    }
    
    withJson = filePath + '.json';
    if (fs.existsSync(withJson)) return withJson;
    
    withIndex = path.join(filePath, 'index.json');
    if (fs.existsSync(withIndex)) return withIndex;
  }
  
  return null;
}

/**
 * Run the build script
 * @param {string} serversDir - Source directory for server files
 * @param {string} distDir - Output directory for built files
 * @returns {Promise<boolean>} true if build succeeded
 */
async function runBuild(serversDir, distDir) {
  if (isBuilding) {
    console.log('⏳ Build already in progress, skipping...');
    return false;
  }

  isBuilding = true;
  
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (serversDir) env.MCP_SERVERS_DIR = serversDir;
    if (distDir) env.MCP_DIST_DIR = distDir;

    console.log('🔨 Starting build...');
    const build = spawn('node', [path.join(__dirname, 'build.js')], {
      cwd: ROOT,
      env,
      stdio: 'inherit'
    });

    build.on('close', (code) => {
      isBuilding = false;
      if (code === 0) {
        lastSuccessfulDistDir = distDir || DIST_DIR;
        buildCache.markBuilt(gitSync.currentCommitHash);
        resolve(true);
      } else {
        console.error(`❌ Build failed with code ${code}`);
        console.log('📦 Continuing to serve last successful build');
        resolve(false);
      }
    });

    build.on('error', (err) => {
      isBuilding = false;
      console.error('❌ Build error:', err.message);
      resolve(false);
    });
  });
}

/**
 * Validate GitHub webhook signature
 */
function validateWebhookSignature(payload, signature) {
  if (!WEBHOOK_SECRET) return true; // No secret configured, accept all
  if (!signature) return false;
  
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(payload).digest('hex');
  
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
}

/**
 * Handle webhook requests (GitHub, GitLab, etc.)
 */
async function handleWebhook(req, res) {
  let body = '';
  
  req.on('data', chunk => { body += chunk; });
  
  req.on('end', async () => {
    // Validate signature if secret is configured
    const signature = req.headers['x-hub-signature-256'];
    if (!validateWebhookSignature(body, signature)) {
      console.warn('⚠️  Webhook signature validation failed');
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid signature' }));
      return;
    }

    try {
      const payload = JSON.parse(body);
      const branch = payload.ref?.replace('refs/heads/', '') || 'unknown';
      
      console.log(`🔔 Webhook received for branch: ${branch}`);
      
      // Only rebuild if it's for our tracked branch
      if (branch === gitSync.branch || !gitSync.isRemote) {
        console.log('🔄 Triggering rebuild from webhook...');
        
        if (gitSync.isRemote) {
          gitSync.pull();
        }
        
        await runBuild(
          gitSync.isRemote ? gitSync.serversDir : undefined,
          DIST_DIR
        );
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: 'Rebuild triggered',
          commit: gitSync.currentCommitHash?.slice(0, 8)
        }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          message: `Ignored (branch ${branch} != ${gitSync.branch})`
        }));
      }
    } catch (err) {
      console.error('❌ Webhook error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook processing failed' }));
    }
  });
}

/**
 * Handle status endpoint
 */
function handleStatus(res) {
  const status = {
    status: 'ok',
    mode: gitSync.isRemote ? 'remote' : 'local',
    repo: gitSync.repoUrl || null,
    branch: gitSync.branch,
    commit: gitSync.currentCommitHash?.slice(0, 8) || null,
    lastBuild: buildCache.info.lastBuild,
    distDir: lastSuccessfulDistDir
  };
  
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status, null, 2));
}

/**
 * Create and configure the HTTPS server
 */
function createServer() {
  const options = loadCertificates();
  
  return https.createServer(options, async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Hub-Signature-256');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    
    const urlPath = req.url;
    
    // Handle webhook endpoint
    if (req.method === 'POST' && urlPath === '/webhook') {
      await handleWebhook(req, res);
      return;
    }
    
    // Handle status endpoint
    if (req.method === 'GET' && urlPath === '/_status') {
      handleStatus(res);
      return;
    }
    
    // Handle manual refresh endpoint
    if (req.method === 'POST' && urlPath === '/_refresh') {
      console.log('🔄 Manual refresh requested');
      if (gitSync.isRemote) {
        const hadUpdates = gitSync.refresh();
        if (hadUpdates || buildCache.needsRebuild(gitSync.currentCommitHash)) {
          await runBuild(gitSync.serversDir, DIST_DIR);
        }
      } else {
        await runBuild(undefined, DIST_DIR);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Refresh complete' }));
      return;
    }
    
    console.log(`${req.method} ${urlPath}`);
    
    const filePath = resolveFilePath(urlPath);
    
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found', path: urlPath }));
      return;
    }
    
    try {
      const content = fs.readFileSync(filePath);
      const mimeType = getMimeType(filePath);
      res.writeHead(200, { 'Content-Type': mimeType });
      res.end(content);
    } catch (err) {
      console.error(`Error reading ${filePath}:`, err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });
}

/**
 * Initialize and start the server
 */
async function main() {
  console.log('🚀 MCP Registry Server\n');
  
  const port = parseInt(process.argv[2]) || DEFAULT_PORT;
  
  try {
    // Initialize git sync (clone if remote, no-op if local)
    const isRemote = await gitSync.initialize();
    
    // Determine if we need to build
    const needsBuild = isRemote 
      ? buildCache.needsRebuild(gitSync.currentCommitHash)
      : !fs.existsSync(path.join(DIST_DIR, 'api'));
    
    if (needsBuild) {
      console.log('\n📦 Building registry...\n');
      const success = await runBuild(
        isRemote ? gitSync.serversDir : undefined,
        DIST_DIR
      );
      if (!success && !fs.existsSync(DIST_DIR)) {
        console.error('❌ Initial build failed and no existing dist/');
        process.exit(1);
      }
    } else {
      console.log('✅ Using cached build (no changes detected)');
    }
    
    // Start polling for updates if using remote repo
    if (isRemote) {
      gitSync.startPolling(async () => {
        console.log('\n🔨 Rebuilding after remote update...');
        await runBuild(gitSync.serversDir, DIST_DIR);
      });
    }
    
    // Create and start the server
    const server = createServer();
    
    server.listen(port, () => {
      console.log(`\n🚀 Server running at https://localhost:${port}`);
      console.log(`   📁 Serving: ${lastSuccessfulDistDir}`);
      if (isRemote) {
        console.log(`   📡 Tracking: ${gitSync.repoUrl} (${gitSync.branch})`);
        console.log(`   ⏱️  Polling: every ${gitSync.pollInterval}s`);
      }
      console.log(`\n📌 Endpoints:`);
      console.log(`   GET  /_status     - Server status`);
      console.log(`   POST /_refresh    - Force rebuild`);
      console.log(`   POST /webhook     - GitHub/GitLab webhook`);
    });
    
    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n👋 Shutting down...');
      gitSync.stopPolling();
      server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
      });
    });
    
  } catch (err) {
    console.error('❌ Startup failed:', err.message);
    process.exit(1);
  }
}

// Run the server
main();
