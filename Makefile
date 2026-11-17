
.PHONY: build test check comments comments-test deps deps-test hooks clean

build:
	npm run build

test:
	npm test

check: test comments-test
	npm run check-package

comments:
	node tools/comment-gate.cjs

comments-test:
	node --test tools/comment-gate.test.cjs

deps:
	node tools/dep-gate.cjs

deps-test:
	node --test tools/dep-gate.test.cjs

hooks:
	git config core.hooksPath .githooks

clean:
	rm -rf .build
