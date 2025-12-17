#!/usr/bin/env node
/**
 * Simple HTTPS server for the MCP Registry that properly handles URL-encoded paths.
 * Usage: node scripts/server.js [port]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const DEFAULT_PORT = 3443;

// Load SSL certificates (create with mkcert if they don't exist)
const certPath = path.join(__dirname, '..', 'localhost.pem');
const keyPath = path.join(__dirname, '..', 'localhost-key.pem');

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error('❌ SSL certificates not found!');
  console.error('Run: mkcert -install && mkcert localhost');
  process.exit(1);
}

const options = {
  cert: fs.readFileSync(certPath),
  key: fs.readFileSync(keyPath),
};

const MIME_TYPES = {
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
};

function getMimeType(path) {
  const ext = path.substring(path.lastIndexOf('.'));
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function resolveFilePath(urlPath) {
  // Keep the URL-encoded path segments intact when mapping to filesystem
  // The filesystem has folders named like "io.github.charris-msft%2Fprompt2mcp"
  
  // Remove query string
  const pathOnly = urlPath.split('?')[0];
  
  // Try exact path first (with index.json for directories)
  let filePath = path.join(DIST_DIR, pathOnly);
  
  if (fs.existsSync(filePath)) {
    // Check if it's a directory - try index.json
    const indexPath = path.join(filePath, 'index.json');
    if (fs.existsSync(indexPath)) {
      return indexPath;
    }
    return filePath;
  }
  
  // Try with index.json appended
  const withIndex = path.join(DIST_DIR, pathOnly, 'index.json');
  if (fs.existsSync(withIndex)) {
    return withIndex;
  }
  
  // Try with .json extension
  const withJson = filePath + '.json';
  if (fs.existsSync(withJson)) {
    return withJson;
  }
  
  return null;
}

const server = https.createServer(options, (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  const urlPath = req.url;
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

const port = parseInt(process.argv[2]) || DEFAULT_PORT;

server.listen(port, () => {
  console.log(`🚀 MCP Registry server running at https://localhost:${port}`);
  console.log(`   Serving files from: ${DIST_DIR}`);
});
