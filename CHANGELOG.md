# Changelog

Notable changes to `@reonarudo/gnuplot-renderer`, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Versions follow
[Releasing](http://192.168.188.68:3001/projects/markdown-renderers/wiki/Releasing): any change to the SVG a fence draws is
at least a minor version.

## [Unreleased]

## [1.0.0] — 2026-10-21

### Added

- Releases: every version is an immutable GitHub Release whose one asset is the `npm pack`
  tarball. Depend on its URL, with `allow-remote=root` in `.npmrc`, instead of a git tag.
- Golden SVG tests for every gnuplot fence in the site's showcase and the extension's demos.
  Every fence draws byte-identical SVG to v0.2.0.

[Unreleased]: https://github.com/Reonarudo/gnuplot-renderer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Reonarudo/gnuplot-renderer/compare/v0.2.0...v1.0.0
