.PHONY: install test build smoke-bundle smoke-mock smoke-live ci clean publish

install:
	bun install

test:
	bun test ./test/apply.test.ts ./test/config.test.ts ./test/errors.test.ts ./test/glob.test.ts ./test/integration.test.ts ./test/log.test.ts ./test/match.test.ts

build:
	bun build src/index.ts --target=bun --outdir=dist --format=esm
	bun x tsc --emitDeclarationOnly --outDir dist

smoke-bundle: build
	bun test ./test/bundle.test.ts

smoke-mock:
	bun scripts/smoke-mock.ts

smoke-live:
	bun scripts/smoke-live.ts

ci: install test build smoke-bundle

clean:
	rm -rf dist node_modules

publish: ci
	bun publish
