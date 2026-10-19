# Contributing to LumioNG

Thanks for helping!

## Reporting bugs and requesting features

Open a GitHub issue. Security problems must not go in a public issue — see [SECURITY.md](SECURITY.md).
For a bug, include your OS, LumioNG version (Help → About → copy info), MongoDB
version and deployment type, and steps to reproduce.

## Pull requests

- Read [`CLAUDE.md`](CLAUDE.md) for structure and conventions and
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit.
- One logical change per pull request, branched from `master` (`feat/…`, `fix/…`).
- Both gates must be green before review:

  ```sh
  npm test && npm run check
  cargo test --manifest-path src-tauri/Cargo.toml
  ```

## License

Contributions are licensed under the [AGPL v3.0](LICENSE).
