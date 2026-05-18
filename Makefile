.PHONY: install test build ci clean publish

install:
	bun install

test:
	bun test

build:
	bun build src/index.ts --target=bun --outdir=dist --format=esm
	bun x tsc --emitDeclarationOnly --outDir dist

ci: install test build

clean:
	rm -rf dist node_modules

publish: ci
	bun publish
