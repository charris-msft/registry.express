# MCP Registry Express

A simplified [Model Context Protocol](https://modelcontextprotocol.io) (MCP) Registry for private and self-hosted scenarios.

## Features

- **Flexible file organization** - Single server per file, multiple servers per file, or any folder structure
- **No database required** - Everything is file-based
- **API compatible** - Implements the official MCP Registry API (v0)
- **Static hosting** - Deploy to GitHub Pages, Azure Static Web Apps, or any static host
- **Auto-rebuild** - GitHub Actions automatically rebuilds when servers are added
- **CLI tool** - Import servers from the official registry with a single command
- **Web UI** - Browse and search your registry

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/registry.express.git
cd registry.express
npm install

# Search the official registry
npm run cli -- search "azure"

# Search multiple keywords
npm run cli -- search "azure|microsoft|github"

# Import a server
npm run cli -- import "com.microsoft/azure"

# Build the static API
npm run build

# Serve locally
npm run serve
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

### Option 1: CLI Import

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

### Option 2: Single Server File

Create a JSON file anywhere in `servers/`:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json",
  "name": "io.github.user/my-server",
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

### Option 3: Multi-Server File

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

### Option 4: Web UI

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

## Deployment

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
