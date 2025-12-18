# MCP Registry Express

A simplified [Model Context Protocol](https://modelcontextprotocol.io) (MCP) Registry for private and self-hosted scenarios. Works with VS Code's MCP Gallery feature.

## Features

- **VS Code Integration** - Use as a custom MCP Gallery service for VS Code
- **Dynamic GitHub Sync** - Servers are fetched from GitHub at runtime, refreshed every 5 minutes
- **No build step required** - Just start the server and it works
- **Flexible file organization** - Single server per file, multiple servers per file, or any folder structure
- **No database required** - Everything is file-based (JSON in GitHub)
- **API compatible** - Implements the official MCP Registry API (v0/v0.1)
- **CLI tool** - Import servers from the official registry with a single command
- **AI Agent** - Use the MCP Server Importer agent to add servers from mcp.json or URLs
- **Web UI** - Browse and search your registry

## Quick Start

### 1. Install

```bash
git clone https://github.com/charris-msft/registry.express.git
cd registry.express
npm install
```

### 2. Create SSL Certificates

VS Code requires HTTPS for custom MCP Gallery services. Install [mkcert](https://github.com/FiloSottile/mkcert):

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

### 3. Start the Server

```bash
npm start
```

That's it! The server:
- Fetches MCP servers from GitHub `main` branch on startup
- Refreshes the cache every 5 minutes
- Serves at `https://localhost:3443`

### 4. Configure VS Code

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

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start dynamic server (fetches from GitHub, refreshes every 5 min) |
| `npm run start:static` | Start static server (serves pre-built dist/) |
| `npm run build` | Build static files from GitHub |
| `npm run build:local` | Build static files from local servers/ |
| `npm run serve:https` | Serve static build over HTTPS (after build) |
| `npm run dev` | Local development with watch mode |
| `npm run cli -- search "azure"` | Search official MCP registry |
| `npm run cli -- import "com.microsoft/azure"` | Import server to local registry |

## Server Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v0.1/servers` | GET | List all servers |
| `/v0.1/servers/{name}/versions/latest` | GET | Get server details |
| `/_status` | GET | Server status and cache info |
| `/_refresh` | POST | Force cache refresh from GitHub |

> **Note**: Server names contain `/` which must be URL-encoded as `%2F`.  
> Example: `https://localhost:3443/v0.1/servers/com.microsoft%2Fazure/versions/latest`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_OWNER` | Repository owner | `charris-msft` |
| `GITHUB_REPO` | Repository name | `registry.express` |
| `GITHUB_BRANCH` | Branch to fetch from | `main` |
| `GITHUB_TOKEN` | GitHub token (for higher rate limits) | (none) |
| `MCP_PORT` | Server port | `3443` |
| `REFRESH_INTERVAL` | Cache refresh interval in ms | `300000` (5 min) |
```

## Project Structure

```
registry.express/
├── servers/                    # Server definitions (in GitHub main branch)
│   ├── com.microsoft/         # By namespace
│   │   └── azure.json         # Single server file
│   ├── examples/              # Or by category
│   │   └── my-servers.json    # Multi-server file
│   └── all-servers.json       # Or everything in one file
├── scripts/
│   ├── dynamic-server.js      # Main server (fetches from GitHub)
│   ├── github-source.js       # GitHub API integration
│   └── build.js               # Static build script
├── src/
│   ├── cli/                   # CLI tool
│   └── web/                   # Web UI source
└── schemas/                    # JSON schemas
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

The agent will create the registry file, commit, and push to GitHub. Changes appear in the registry within 5 minutes (or immediately with `POST /_refresh`).

### Option 2: CLI Import

Import from the official MCP Registry:

```bash
# Search for servers
npm run cli -- search "azure"

# Import latest version
npm run cli -- import "com.microsoft/azure"

# Import all versions
npm run cli -- import "com.microsoft/azure" --all-versions
```

### Option 3: Manual JSON File

Create a JSON file in `servers/` and push to GitHub:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.user/my-server",
  "title": "My Server",
  "description": "My awesome MCP server",
  "version": "1.0.0",
  "repository": {
    "url": "https://github.com/user/my-server",
    "source": "github"
  },
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@user/my-server",
      "runtimeHint": "npx",
      "transport": { "type": "stdio" }
    }
  ]
}
```

> **Note**: The `name` field is the unique identifier and should match the key in your mcp.json for gallery enrichment.

## Schema

Server definitions use the [official MCP server schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json).

### Required Fields

| Field | Description |
|-------|-------------|
| `name` | Reverse-DNS format with one slash (e.g., `io.github.user/server`) |
| `description` | Human-readable description (max 100 chars) |
| `version` | Semantic version string (e.g., `1.0.0`) |

### Optional Fields

| Field | Description |
|-------|-------------|
| `title` | Friendly display name |
| `icons` | Array of icon objects with `src`, `mimeType`, `sizes` |
| `repository` | Object with `url` and `source` |
| `websiteUrl` | Link to documentation |
| `packages` | Array of package distributions |

### Package Object

| Field | Description |
|-------|-------------|
| `registryType` | `npm`, `pypi`, `oci`, `nuget`, or `mcpb` |
| `identifier` | Package name or URL |
| `transport` | `{ type: "stdio" }` or `{ type: "sse", url: "..." }` |
| `runtimeHint` | `npx`, `uvx`, `docker`, `python`, etc. |
| `environmentVariables` | Array of env var definitions |

## Deployment

### Docker

```bash
docker run -p 3443:3443 \
  -e GITHUB_OWNER=your-org \
  -e GITHUB_REPO=your-registry \
  -v $(pwd)/localhost.pem:/app/localhost.pem \
  -v $(pwd)/localhost-key.pem:/app/localhost-key.pem \
  your-registry-image
```

### Static Build (GitHub Pages, Azure Static Web Apps)

For static hosting, use the build command instead of the dynamic server:

```bash
npm run build
# Upload dist/ to your host
```

## Contributing

1. Fork the repository
2. Add or update servers in `servers/`
3. Push to GitHub - changes appear within 5 minutes
4. Submit a pull request

## License

MIT
