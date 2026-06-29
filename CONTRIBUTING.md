# Contributing to Open Memory Protocol

Thank you for helping build the open standard for AI memory.

## Ways to contribute

### 1. Build an adapter
Connect a new AI tool to OMP. See [`adapters/claude-mcp`](adapters/claude-mcp) as a reference. Adapters for OpenAI, Cursor, Gemini, and local models are all needed.

### 2. Improve the spec
Read [`SPEC.md`](SPEC.md) and open an issue if something is unclear, missing, or wrong. Spec PRs require discussion before merging.

### 3. Build an SDK
We have TypeScript and Python. Go, Rust, Java, and Ruby SDKs are welcome.

### 4. Report bugs
Open an issue with reproduction steps. For security issues, email directly rather than opening a public issue.

### 5. Improve the reference server
Performance improvements, new storage backends (PostgreSQL, Redis), and better test coverage are all valuable.

## Development setup

```bash
git clone https://github.com/SMJAI/open-memory-protocol
cd open-memory-protocol

# Start reference server
cd packages/server
npm install
npm run dev

# In another terminal — test it
curl http://localhost:3456/v1/health
```

## Pull request guidelines

- One PR per change — keep scope tight
- New features need a spec update in `SPEC.md` if they change the protocol
- Follow existing code style — TypeScript strict mode, no `any`
- Adapters should include a README with setup instructions

## Spec change process

Changes to the protocol spec in `SPEC.md` follow this process:
1. Open a GitHub Issue labelled `spec:proposal` describing the change and motivation
2. Discussion period (minimum 7 days for minor changes, 30 days for breaking changes)
3. Reference implementation in a PR
4. Merge after consensus

## Code of conduct

Be kind, be direct, assume good intent. This project welcomes contributors of all experience levels.
