# MCP Registry Express

A simplified [Model Context Protocol](https://modelcontextprotocol.io) (MCP) Registry for private and self-hosted scenarios. Works with VS Code's MCP Gallery feature.

## Features

- **VS Code Integration** - Use as a custom MCP Gallery service for VS Code
- **Flexible file organization** - Single server per file, multiple servers per file, or any folder structure
- **No database required** - Everything is file-based
- **API compatible** - Implements the official MCP Registry API (v0/v0.1)
- **Static hosting** - Deploy to GitHub Pages, Azure Static Web Apps, or any static host
- **Auto-rebuild** - GitHub Actions automatically rebuilds when servers are added
- **CLI tool** - Import servers from the official registry with a single command
- **AI Agent** - Use the MCP Server Importer agent to add servers from mcp.json or URLs
- **Web UI** - Browse and search your registry

## Quick Start

### Prerequisites for Local Testing

VS Code requires HTTPS for custom MCP Gallery services. Install [mkcert](https://github.com/FiloSottile/mkcert) to create local SSL certificates:

```bash
# Install mkcert (Windows with Chocolatey)
choco install mkcert

# Or with Scoop
scoop install mkcert

# Or on macOS
brew install mkcert

# Install the local CA and create certificates
mkcert -install
mkcert localhost
```

This creates `localhost.pem` and `localhost-key.pem` in your current directory.

### Installation

```bash
# Clone and install
git clone https://github.com/your-org/registry.express.git
cd registry.express
npm install

# Create SSL certificates (required for VS Code)
mkcert localhost

# Search the official registry
npm run cli -- search "azure"

# Import a server
npm run cli -- import "com.microsoft/azure"

# Build the static API
npm run build

# Start the HTTPS server
npm run serve:https
# Or: node scripts/server.cjs
```

### Configure VS Code

Add these settings to use your private registry:

```json
{
  "chat.mcp.gallery.enabled": true,
  "chat.mcp.gallery.serviceUrl": "https://localhost:3443"
}
```

Then in your `mcp.json`, add the `gallery` property to servers you want to enrich:

```json
{
  "servers": {
    "com.microsoft/azure": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@azure/mcp@latest", "server", "start"],
      "gallery": "https://localhost:3443"
    }
  }
}
```

## Project Structure

```
registry.express/
├── servers/                    # Server definitions (organize as you like)
│   ├── com.microsoft/         # By namespace
│   │   └── azure.json         # Single server file
│   ├── examples/              # Or by category
│   │   └── my-servers.json    # Multi-server file
│   └── all-servers.json       # Or everything in one file
├── dist/                       # Generated (gitignored)
│   ├── api/v0.1/              # Static API endpoints
│   └── index.html             # Web UI
├── schemas/                    # JSON schemas
├── src/
│   ├── cli/                   # CLI tool
│   └── web/                   # Web UI source
└── scripts/                    # Build scripts
```

## Adding Servers

### Option 1: AI Agent (Recommended)

Use the **MCP Server Importer** agent in VS Code to add servers interactively:

1. Open VS Code with this repository
2. Open Copilot Chat and type `@MCP Server Importer`
3. Choose your import method:
   - **"Import from my mcp.json"** - Select servers from your VS Code MCP configuration
   - **"Import from URL"** - Provide a GitHub repo or documentation URL
   - **"Add from JSON"** - Paste raw JSON configuration

The agent will:
- Extract package information (npm, pypi, etc.)
- Generate a proper `name` in reverse-DNS format
- Ask for a friendly `title` for display
- Create the registry file with all required fields
- Tell you how to update your mcp.json for gallery enrichment

### Option 2: CLI Import

### Option 2: CLI Import

Import from the official MCP Registry:

```bash
# Search for servers
npm run cli -- search "azure"

# Search for specific servers by name
npm run cli -- search "com.microsoft/azure|io.github.github/github-mcp-server"

# Import latest version
npm run cli -- import "com.microsoft/azure"

# Import all versions
npm run cli -- import "com.microsoft/azure" --all-versions

# Import into a specific file (multi-server format)
npm run cli -- import "com.microsoft/azure" --file servers/my-favorites.json

# Search and import all results
npm run cli -- search "com.microsoft/azure|io.github.github/github-mcp-server" --import-all
```

### Option 3: Single Server File

Create a JSON file anywhere in `servers/`:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json",
  "name": "io.github.user/my-server",
  "title": "My Server",
  "description": "My awesome MCP server",
  "repository": {
    "url": "https://github.com/user/my-server",
    "source": "github"
  },
  "versions": [
    {
      "version": "1.0.0",
      "releaseDate": "2024-01-15",
      "isLatest": true,
      "packages": [
        {
          "registryType": "npm",
          "identifier": "@user/my-server",
          "runtimeHint": "npx",
          "transport": { "type": "stdio" }
        }
      ]
    }
  ]
}
```

> **Note**: The `name` field is the unique identifier and should be used as the key in your mcp.json for gallery enrichment. The `title` field provides a friendly display name in VS Code's MCP gallery view.

### Option 4: Multi-Server File

Keep multiple servers in one file for convenience:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json",
  "servers": [
    {
      "name": "io.github.user/server-one",
      "description": "First server",
      "versions": [...]
    },
    {
      "name": "io.github.user/server-two",
      "description": "Second server",
      "versions": [...]
    }
  ]
}
```

This is useful when:
- You have a small number of servers and want everything in one place
- You want to group related servers together
- You want the same server with different version/config combinations

### Option 5: Web UI

1. Open the Web UI
2. Go to "Import Server" tab
3. Search the official registry
4. Click "Import" on the server you want

## CLI Commands

> **Note:** Use `--` after `npm run cli` to pass arguments to the script.

```bash
# Search official registry
npm run cli -- search <query>
npm run cli -- search "azure|microsoft"      # Multiple keywords
npm run cli -- search "azure" --json         # Output names only (for piping)
  -r, --registry <url>      Source registry URL
  -l, --limit <n>           Maximum results (default: 20)
  -j, --json                Output server names only (for piping)

# Import a server
npm run cli -- import <server-name>
  -v, --version <version>   Specific version (default: latest)
  --all-versions            Import all available versions
  -r, --registry <url>      Source registry URL
  -f, --file <path>         Target file (uses multi-server format)
  -o, --output <dir>        Output directory (default: ./servers)

# List local servers
npm run cli -- list
  -d, --dir <dir>           Servers directory (default: ./servers)

# Build the registry
npm run cli -- build
  -w, --watch               Watch for changes
```

## API Endpoints

The generated API is compatible with the official MCP Registry:

| Endpoint | Description |
|----------|-------------|
| `GET /api/index.json` | **Discovery document** – lists available resources and API version |
| `GET /api/v0.1/servers.json` | List all servers |
| `GET /api/v0.1/servers/{name}/versions.json` | List versions for a server |
| `GET /api/v0.1/servers/{name}/versions/{version}.json` | Get specific version |
| `GET /api/v0.1/servers/{name}/versions/latest.json` | Get latest version |

### Simple Index (PEP 503/691 style)

A lightweight, cache-friendly index is also generated for easy browsing:

| Endpoint | Description |
|----------|-------------|
| `GET /api/simple/` | HTML index of all server names |
| `GET /api/simple/index.json` | JSON index of all server names |
| `GET /api/simple/{name}/` | HTML page listing versions for a server |
| `GET /api/simple/{name}/index.json` | JSON list of versions for a server |

### Search

Use the CLI to search the official MCP Registry:

```bash
npm run cli -- search "azure"
npm run cli -- search "azure|microsoft"  # multiple keywords
```

## Local Development

VS Code requires HTTPS for custom MCP Gallery services. For local development, use the custom HTTPS server:

```bash
# Generate SSL certificates with mkcert (one-time setup)
mkcert -install
mkcert localhost

# Build and serve with HTTPS
npm run build
npm run serve:https
```

The server runs at `https://localhost:3443` by default. The certificate files (`localhost.pem` and `localhost-key.pem`) should be in the project root.

> **Note**: The standard `npm run serve` (HTTP) works for browsing the registry, but VS Code will only accept HTTPS URLs for the gallery service.

## Deployment

> **Important**: VS Code's MCP Gallery requires HTTPS. When deploying to production, ensure your host provides SSL certificates (GitHub Pages, Azure Static Web Apps, and most cloud hosts do this automatically).

### GitHub Pages

1. Push to GitHub
2. Enable GitHub Pages in repository settings (use GitHub Actions)
3. The workflow in `.github/workflows/build.yml` handles deployment

### Azure Static Web Apps

1. Create an Azure Static Web App
2. Point it to your repository
3. Set the output location to `dist`

### Docker / Container

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
```

### Manual / Other Hosts

1. Run `npm run build`
2. Upload the `dist/` directory to your host

## Configuration

### GitHub OAuth (for Web UI import)

To enable direct GitHub imports from the Web UI:

1. Create a GitHub OAuth App
2. Set the callback URL to your registry URL
3. In the browser console or localStorage:
   ```javascript
   localStorage.setItem('github_client_id', 'your-client-id');
   localStorage.setItem('github_repo', 'your-org/registry.express');
   ```

Note: For static hosting, you'll need a backend service to exchange OAuth codes for tokens, or users can set tokens manually.

## Schema

Server definitions use the [official MCP server schema](https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json).

### File Formats

**Single Server Format:**
```json
{
  "$schema": "...",
  "name": "...",
  "description": "...",
  "versions": [...]
}
```

**Multi-Server Format:**
```json
{
  "$schema": "...",
  "servers": [
    { "name": "...", "description": "...", "versions": [...] },
    { "name": "...", "description": "...", "versions": [...] }
  ]
}
```

### Required Fields

- `name` - Reverse-DNS format with one slash (e.g., `io.github.user/server`)
- `description` - Human-readable description (1-500 chars)
- `versions` - Array of version objects

### Version Object

- `version` - Semantic version string
- `packages` - Array of package distributions
- `releaseDate` - ISO date (optional)
- `isLatest` - Boolean flag for latest version

### Package Object

- `registryType` - `npm`, `pypi`, `oci`, `nuget`, or `mcpb`
- `identifier` - Package name or URL
- `transport` - `{ type: "stdio" | "streamable-http" | "sse" }`
- `runtimeHint` - `npx`, `docker`, `python`, etc.
- `environmentVariables` - Array of required/optional env vars

## Contributing

1. Fork the repository
2. Add or update servers in `servers/`
3. Run `npm run build` to test
4. Submit a pull request

## License

MIT
