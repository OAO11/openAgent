# Convenience aliases; pnpm scripts are the source of truth.
.DEFAULT_GOAL := dev
.PHONY: dev build preview prepare-kbrain check-fast check-all check-strict

dev:
	pnpm dev
build:
	pnpm build
preview:
	pnpm preview:build
prepare-kbrain:
	pnpm prepare:kbrain
check-fast:
	pnpm check:fast
check-all:
	pnpm check:all
check-strict:
	pnpm check:strict
