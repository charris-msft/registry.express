/**
 * MCP Registry Express - Web Application
 */

const OFFICIAL_REGISTRY = 'https://registry.modelcontextprotocol.io';
const LOCAL_API = '/v0.1';

// GitHub OAuth configuration (to be set by the user)
const GITHUB_CLIENT_ID = localStorage.getItem('github_client_id') || '';
const GITHUB_REPO = localStorage.getItem('github_repo') || '';

// State
let localServers = [];
let selectedServer = null;

// DOM Elements
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');
const searchInput = document.getElementById('search-input');
const serverList = document.getElementById('server-list');
const officialSearch = document.getElementById('official-search');
const searchOfficialBtn = document.getElementById('search-official-btn');
const officialResults = document.getElementById('official-results');
const modal = document.getElementById('server-modal');
const modalBody = document.getElementById('modal-body');
const modalClose = document.querySelector('.modal-close');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadLocalServers();
  setupEventListeners();
  checkGitHubAuth();
});

function setupEventListeners() {
  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Search local
  searchInput.addEventListener('input', () => filterLocalServers(searchInput.value));

  // Search official
  searchOfficialBtn.addEventListener('click', () => searchOfficialRegistry());
  officialSearch.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchOfficialRegistry();
  });

  // Modal
  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  // GitHub auth
  document.getElementById('github-login-btn')?.addEventListener('click', loginWithGitHub);
  document.getElementById('github-logout-btn')?.addEventListener('click', logoutGitHub);
}

// Tab Management
function switchTab(tabId) {
  tabs.forEach(t => t.classList.remove('active'));
  tabContents.forEach(c => c.classList.remove('active'));

  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  document.getElementById(tabId).classList.add('active');
}

// Local Server Management
async function loadLocalServers() {
  try {
    const response = await fetch(`${LOCAL_API}/servers`);
    if (!response.ok) throw new Error('Failed to load servers');

    const data = await response.json();
    // Handle the wrapped format: { servers: [{ server: {...}, _meta: {...} }, ...] }
    const rawServers = data.servers || [];
    localServers = rawServers.map(item => item.server ? item.server : item);
    renderLocalServers(localServers);
  } catch (err) {
    serverList.innerHTML = `
      <div class="empty-state">
        <p>No servers found in local registry.</p>
        <p>Use the Import tab to add servers from the official registry.</p>
      </div>
    `;
  }
}

function filterLocalServers(query) {
  const filtered = localServers.filter(s =>
    s.name.toLowerCase().includes(query.toLowerCase()) ||
    s.description.toLowerCase().includes(query.toLowerCase())
  );
  renderLocalServers(filtered);
}

function renderLocalServers(servers) {
  if (servers.length === 0) {
    serverList.innerHTML = `
      <div class="empty-state">
        <p>No servers match your search.</p>
      </div>
    `;
    return;
  }

  serverList.innerHTML = servers.map(server => `
    <div class="server-card" onclick="showServerDetail('${server.name}', 'local')">
      <h3>${escapeHtml(server.name)}</h3>
      <p>${escapeHtml(server.description)}</p>
      <div class="server-meta">
        <span>v${escapeHtml(server.version || 'unknown')}</span>
        ${server.repository ? `<span>${escapeHtml(server.repository.source || 'git')}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// Official Registry Search
async function searchOfficialRegistry() {
  const query = officialSearch.value.trim();
  if (!query) return;

  officialResults.innerHTML = '<p class="loading">Searching...</p>';

  try {
    // Use the search endpoint with query parameter
    const response = await fetch(`${OFFICIAL_REGISTRY}/v0/servers?search=${encodeURIComponent(query)}`);
    if (!response.ok) throw new Error('Failed to fetch');

    const data = await response.json();
    const rawServers = data.servers || [];

    // Handle official registry format (nested {server, _meta})
    const servers = rawServers.map(s => s.server ? s.server : s);

    // Dedupe by name (may have multiple versions)
    const seen = new Set();
    const unique = servers.filter(s => {
      if (seen.has(s.name)) return false;
      seen.add(s.name);
      return true;
    });

    renderOfficialResults(unique.slice(0, 20));
  } catch (err) {
    officialResults.innerHTML = `
      <div class="empty-state">
        <p>Failed to search official registry.</p>
        <p>${escapeHtml(err.message)}</p>
      </div>
    `;
  }
}

function renderOfficialResults(servers) {
  if (servers.length === 0) {
    officialResults.innerHTML = `
      <div class="empty-state">
        <p>No servers found matching your query.</p>
      </div>
    `;
    return;
  }

  officialResults.innerHTML = servers.map(server => `
    <div class="server-card">
      <h3>${escapeHtml(server.name)}</h3>
      <p>${escapeHtml(server.description)}</p>
      <div class="server-meta">
        <span>v${escapeHtml(server.version || 'unknown')}</span>
      </div>
      <div class="server-actions">
        <button class="btn btn-small" onclick="showServerDetail('${server.name}', 'official')">View Details</button>
        <button class="btn btn-small btn-primary" onclick="importServer('${server.name}')">Import</button>
      </div>
    </div>
  `).join('');
}

// Server Detail Modal
async function showServerDetail(serverName, source) {
  const encodedName = encodeURIComponent(serverName);

  modal.classList.add('active');
  modalBody.innerHTML = '<p class="loading">Loading...</p>';

  try {
    const url = source === 'official'
      ? `${OFFICIAL_REGISTRY}/v0/servers/${encodedName}/versions/latest`
      : `${LOCAL_API}/servers/${encodedName}/versions/latest`;

    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load server details');

    let serverData = await response.json();
    // Handle official registry format (nested {server, _meta})
    const server = serverData.server ? serverData.server : serverData;
    selectedServer = server;

    // Try to get all versions
    let versions = [server];
    try {
      const versionsUrl = source === 'official'
        ? `${OFFICIAL_REGISTRY}/v0/servers/${encodedName}/versions`
        : `${LOCAL_API}/servers/${encodedName}/versions`;
      const versionsResponse = await fetch(versionsUrl);
      if (versionsResponse.ok) {
        const versionsData = await versionsResponse.json();
        // Both official and local use wrapped format: {servers: [{server, _meta}, ...]}
        const rawServers = versionsData.servers || [];
        versions = rawServers.map(s => s.server ? s.server : s);
      }
    } catch (e) { /* ignore */ }

    renderServerDetail(server, versions, source);
  } catch (err) {
    modalBody.innerHTML = `
      <p>Failed to load server details.</p>
      <p>${escapeHtml(err.message)}</p>
    `;
  }
}

function renderServerDetail(server, versions, source) {
  const packages = server.packages || [];

  modalBody.innerHTML = `
    <h2>${escapeHtml(server.name)}</h2>
    <p>${escapeHtml(server.description)}</p>

    ${server.repository ? `
      <p><a href="${escapeHtml(server.repository.url)}" target="_blank">View Repository</a></p>
    ` : ''}

    ${source === 'official' ? `
      <div class="server-actions" style="margin-top: 16px;">
        <button class="btn btn-primary" onclick="importServer('${server.name}')">Import to Registry</button>
        <button class="btn" onclick="importServer('${server.name}', true)">Import All Versions</button>
      </div>
    ` : ''}

    <h3>Versions</h3>
    <div class="version-list">
      ${versions.map(v => `
        <div class="version-item">
          <div class="version-header">
            <span>v${escapeHtml(v.version || 'unknown')}</span>
            ${v.isLatest ? '<span class="version-tag latest">latest</span>' : ''}
          </div>
          ${v.releaseDate ? `<small>${escapeHtml(v.releaseDate)}</small>` : ''}
        </div>
      `).join('')}
    </div>

    ${packages.length > 0 ? `
      <h3>Packages</h3>
      <div class="package-list">
        ${packages.map(pkg => `
          <div class="package-item">
            <code>${escapeHtml(pkg.registryType)}</code>
            ${escapeHtml(pkg.identifier)}
            ${pkg.runtimeHint ? `(${escapeHtml(pkg.runtimeHint)})` : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${server.packages?.[0]?.environmentVariables?.length ? `
      <h3>Environment Variables</h3>
      <div class="package-list">
        ${server.packages[0].environmentVariables.map(env => `
          <div class="package-item">
            <code>${escapeHtml(env.name)}</code>
            ${env.description ? `- ${escapeHtml(env.description)}` : ''}
            ${env.required === false ? ' (optional)' : ''}
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

function closeModal() {
  modal.classList.remove('active');
  selectedServer = null;
}

// Import Server
async function importServer(serverName, allVersions = false) {
  const token = localStorage.getItem('github_token');

  if (!token) {
    // Show CLI instructions instead
    showToast(`To import, run: npm run cli import "${serverName}"${allVersions ? ' --all-versions' : ''}`, 'info');
    return;
  }

  // GitHub import flow
  showToast('Importing server...', 'info');

  try {
    // Fetch server data from official registry
    const encodedName = encodeURIComponent(serverName);
    let serverData;

    if (allVersions) {
      // Fetch all versions - returns {servers: [{server, _meta}, ...]}
      const versionsRes = await fetch(`${OFFICIAL_REGISTRY}/v0/servers/${encodedName}/versions`);
      const versionsData = await versionsRes.json();
      const rawServers = versionsData.servers || [];

      const versions = rawServers.map(item => item.server ? item.server : item);
      if (versions.length > 0) {
        serverData = { ...versions[0], versions };
      } else {
        throw new Error('No versions found');
      }
    } else {
      const res = await fetch(`${OFFICIAL_REGISTRY}/v0/servers/${encodedName}/versions/latest`);
      const data = await res.json();
      // Handle nested format
      serverData = data.server ? data.server : data;
      serverData.versions = [{
        version: serverData.version,
        releaseDate: serverData.releaseDate,
        isLatest: true,
        packages: serverData.packages
      }];
    }

    // Transform to our format
    const [namespace, name] = serverName.split('/');
    const filePath = `servers/${namespace}/${name}.json`;
    const content = JSON.stringify({
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json',
      name: serverData.name,
      description: serverData.description,
      repository: serverData.repository,
      websiteUrl: serverData.websiteUrl,
      versions: serverData.versions.map((v, i) => ({
        version: v.version,
        releaseDate: v.releaseDate,
        isLatest: i === 0,
        packages: v.packages || []
      }))
    }, null, 2);

    // Create file via GitHub API
    await createGitHubFile(filePath, content, `Add ${serverName} to registry`);

    showToast(`Successfully imported ${serverName}!`, 'success');
    closeModal();
  } catch (err) {
    showToast(`Import failed: ${err.message}`, 'error');
  }
}

// GitHub Integration
function checkGitHubAuth() {
  const token = localStorage.getItem('github_token');
  const username = localStorage.getItem('github_username');

  if (token && username) {
    document.getElementById('github-auth').style.display = 'none';
    document.getElementById('github-user').style.display = 'block';
    document.getElementById('github-username').textContent = username;
    document.getElementById('github-section').style.display = 'block';
  }

  // Check for OAuth callback
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  if (code) {
    handleGitHubCallback(code);
  }
}

function loginWithGitHub() {
  if (!GITHUB_CLIENT_ID) {
    showToast('GitHub OAuth not configured. Please set github_client_id in localStorage.', 'error');
    return;
  }

  const redirectUri = window.location.origin + window.location.pathname;
  const scope = 'repo';
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}`;

  window.location.href = authUrl;
}

async function handleGitHubCallback(code) {
  // Note: In production, you'd exchange the code for a token via a backend
  // For static hosting, users need to use a service like netlify functions or manually set the token
  showToast('OAuth callback received. For static hosting, please set your token manually in localStorage.', 'info');

  // Clean up URL
  window.history.replaceState({}, document.title, window.location.pathname);
}

function logoutGitHub() {
  localStorage.removeItem('github_token');
  localStorage.removeItem('github_username');
  document.getElementById('github-auth').style.display = 'block';
  document.getElementById('github-user').style.display = 'none';
  showToast('Signed out of GitHub', 'info');
}

async function createGitHubFile(path, content, message) {
  const token = localStorage.getItem('github_token');
  const repo = GITHUB_REPO || localStorage.getItem('github_repo');

  if (!token || !repo) {
    throw new Error('GitHub not configured');
  }

  const response = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: btoa(content),
      branch: 'main'
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'GitHub API error');
  }

  return response.json();
}

// Utilities
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 5000);
}

// Make functions globally available
window.showServerDetail = showServerDetail;
window.importServer = importServer;
