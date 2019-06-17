# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2019-06-17

### Fixed

- `currentWorkingDirectory` option now works.
- S3 now omits `ContentMD5` when uploading as it is unsupported for multipart uploads (file greater than 5 MB).

## [1.0.0] - 2019-06-16

### Added

- Initial release with support for S3, Azure and GCP.
