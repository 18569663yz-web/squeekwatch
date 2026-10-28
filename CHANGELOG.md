# Changelog

All notable changes to Squeekwatch are recorded here. This project follows
[Semantic Versioning](https://semver.org/).

## 0.1.0 — 2026-10-29

- Zero-dependency observer for the Squeekchain hamster economy: one snapshot joins
  `api.squeekchain.com` telemetry, `community.squeekchain.com` Genesis data and a live
  Sepolia JSON-RPC probe of the deployed contracts.
- Invariant audit engine that cross-checks supply, NFT, round, settlement, staking and
  gacha consistency, and reports `VERIFIED` / `DEGRADED` / `FAILED` with a per-finding
  breakdown instead of a single opaque score.
- Three surfaces on the same engine: a terminal CLI, a self-contained dashboard page and
  a stdio MCP server so agents can read the same verified state.
