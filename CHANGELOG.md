# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.0.0] - 2021-05-05

### Added

- Automatically create compressed copies of files with `br` and `gzip` using new `encoding` option.
- Object tagging for AWS and Azure.

## [3.0.0] - 2020-04-27

### Changed

- Update `@azure/storage-blob` to version `12` and fix implementation.
- Update dependencies to latest version.
- Improve unit tests and add CI.

## [2.0.1] - 2019-06-18

### Fixed

- Built-in mime types not working when custom mime types are specified.
- Example code in README.
- Error message for destination argument in CLI.

## [2.0.0] - 2019-06-18

### Fixed

- Allow bucket name to have dots for CLI.
- Better error handling.

### Added

- Define custom MIME types through `mimeTypes`.

### Changed

- `metadata` PushOption now accepts function.

## [1.0.1] - 2019-06-17

### Fixed

- `currentWorkingDirectory` option now works.
- S3 now omits `ContentMD5` when uploading as it is unsupported for multipart uploads (file greater than 5 MB).

## [1.0.0] - 2019-06-16

### Added

- Initial release with support for S3, Azure and GCP.
