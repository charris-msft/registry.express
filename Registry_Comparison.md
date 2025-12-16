# Registry Comparison and Recommendations

## Scope
- Compare established package/artifact registries (PyPI, npm, NuGet, Cargo/crates.io, Maven Central, OCI registries) against the current static JSON + build aggregation model used in this repo. Focus on discoverability, replication, immutability, metadata shape, and operational features.

## Patterns from Other Registries

- **PyPI (PEP 503/691 simple API)**: Root HTML index lists all projects; each project page lists downloadable files with hashes; directory-style, cacheable, CDN-friendly; JSON variant (PEP 691) adds machine-readable parity. [source: https://peps.python.org/pep-0503/]
- **npm**: CouchDB-based metadata with built-in replication; tarballs served separately via CDN; "skimdb" provides attachment-free metadata for lightweight mirroring; "fullfat" reconstructs attachments. [source: https://blog.npmjs.org/post/75707294465/new-npm-registry-architecture.html]
- **NuGet v3**: Entry-point `index.json` advertises resource endpoints (`PackageBaseAddress`, `SearchQueryService`, `Registrations`, `PackagePublish`); clients discover capabilities via `@type`/`@id` values. [source: https://learn.microsoft.com/en-us/nuget/api/service-index]
- **Cargo / crates.io**: Registry index is a git or sparse HTTP tree of small metadata files; sparse protocol uses HTTP range/ETag/Last-Modified for fast incremental updates and avoids cloning the full index. [source: https://doc.rust-lang.org/cargo/reference/registry-index.html]
- **Maven Central**: Strict content-addressable-ish directory layout (groupId → artifactId → version) with checksums, signatures, and metadata (`maven-metadata.xml`); static file hosting over HTTP/HTTPS; clients rely on predictable paths and optional indexes. [source: https://maven.apache.org/repository/layout.html]
- **OCI Distribution (e.g., Docker/ACR/GHCR)**: Content-addressed blobs + manifests; HTTP API with resumable uploads, range GETs, referrers API for attaching artifacts (SBOMs, signatures); conformance categories: Pull, Push, Content Discovery, Content Management. [source: https://github.com/opencontainers/distribution-spec/blob/main/spec.md]

## Observations vs. current registry.express model
- We generate a **static, aggregated API** (`dist/api/v0.1/...`) from JSON sources; great for read-only hosting and CDN caching, but lacks incremental update semantics that clients expect from package managers.
- No **discovery document** equivalent to NuGet `index.json` or OCI `/v2/` feature probing; clients must know paths ahead of time.
- **Replication/mirroring** story is implicit (git clone the repo); there’s no lightweight mirror feed (e.g., npm skim, Cargo sparse) or changefeed.
- **Integrity/signing**: JSON carries versions and packages but not checksums, signatures, or yanked flags; other ecosystems embed hashes (PyPI), checksums/signatures (Maven), or content digests (OCI).
- **Content addressing & referrers**: Entries point to packages but not normalized digests or a way to attach related artifacts (SBOM, signatures) like OCI referrers.
- **Search/indexing**: Build produces summary lists, but there is no search API; ecosystems either index locally (Cargo git/sparse), provide search endpoints (NuGet), or external search (npm/Elastic).
- **Client compatibility**: Our schema is MCP-specific; there’s no compatibility layer to emulate common client protocols (simple HTML/JSON, NuGet v3, OCI).

## Recommendations (focused for our scope)

1) **Publish a discovery document**
- Add a small JSON entry-point (NuGet-style `index.json`) that advertises the resources we already expose (servers list, versions, search). This lets future clients discover capabilities without schema changes. [source: https://learn.microsoft.com/en-us/nuget/api/service-index]

2) **Expose a lightweight, cache-friendly index**
- Serve a simple index (HTML + optional JSON) of server names and versions, similar to PEP 503/691, to make browsing and caching trivial. Keep it static-generated alongside the existing build. [source: https://peps.python.org/pep-0503/]

3) **Keep existing search, just surface it in discovery**
- Since we already have a search command, document its endpoint in the discovery JSON so clients know where to call it. No new search backend needed unless we decide to expand features. [source: https://learn.microsoft.com/en-us/nuget/api/service-index]

Out-of-scope given constraints and private, curated usage
- Content integrity/signatures and yanking flags are not required because we only store pointers and trust the small set of publishers.
- Mirroring/replication feeds are unnecessary for the expected few-thousand-scale, private-network deployments.
- OCI content-addressable artifacts and multi-protocol shims are not needed; we will stick to the single MCP schema we control.
- Extra CDN/ETag mechanics are optional; can revisit if latency or bandwidth becomes a concern.

## Quick win checklist for this repo
- [ ] Add discovery JSON (`/api/index.json`) advertising resources (servers list, versions, search endpoint) and schema version.
- [ ] Generate a simple HTML/JSON index for servers and versions (PEP 503/691 style) in the static build output.
- [ ] Update docs to clarify search exists and where it lives.
