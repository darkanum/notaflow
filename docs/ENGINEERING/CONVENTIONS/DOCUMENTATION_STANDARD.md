# Documentation Standard

This is how NotaFlow organizes documentation. Every new doc follows these rules. When in doubt, copy the shape of an existing doc that follows them.

The standard exists so that people and AI agents find any doc the same way, every time.

## Rules

### 1. One AI entrypoint at the root and in each package

- The repo root has one `AGENTS.md`. It holds the global rules and routes to packages and to `docs/`.
- Every package (anything with a `package.json` or a `pyproject.toml`) has exactly one `AGENTS.md` at its root.
- There is no `CLAUDE.md`, `INDEX.md`, or `_AI_CONTEXT.md`. Tool-specific config files may exist, but they never copy `AGENTS.md` content.

### 2. Code packages keep only `AGENTS.md`

- A package has no `docs/` folder and no `README.md`.
- Its `AGENTS.md` is a short list of pointers into `docs/`, not a second home for docs.

### 3. File and folder names use `SCREAMING_SNAKE_CASE`

- `MY_DOC.md`, not `my-doc.md` or `MyDoc.md`. Folders too: `ARCHITECTURE/`, `CONVENTIONS/`.
- Exception: GitHub files keep their names (`README.md`, `LICENSE`, `CHANGELOG.md`).

### 4. Folder or flat

- Dated categories (`PLANS/`, `RFCS/`, `POST_MORTEMS/`) are flat inside each `YYYY/MM/` folder. Companion assets sit next to the doc. No subfolders.
- In other categories, a doc with companion files lives in its own folder (`MY_DOC/MY_DOC.md`). A self-contained doc is flat (`MY_DOC.md`).
- A companion doc with a generic name gets the main doc's name as a prefix: `MY_PLAN_OVERVIEW.md`.

### 5. Dated categories use `YYYY/MM/`

`docs/ENGINEERING/PLANS/`, `docs/ENGINEERING/RFCS/`, and `docs/ENGINEERING/POST_MORTEMS/` use `YYYY/MM/`. The month is the month the doc was written.

### 6. Cross-links are relative

- Use `[Human Title](relative/path.md)`. Never an absolute path, never a bare URL.
- No `#heading` anchors in indexes.
- To reach another package, link its `AGENTS.md`, not a deep doc.

### 7. Package `AGENTS.md` shape

```markdown
# <Package>: AI Context

<one paragraph: what this package is>

## Quick Reference

- Entry points: ...
- Depends on: ...

## Documentation Index

- [Title](../../docs/CATEGORY/DOC.md) - one-line description

## Key Rules

1. ...
```

Keep it under about 80 lines. Long content goes into a doc under `docs/` and gets a link.

### 8. `docs/README.md` is the docs hub

It lists each category and says where each kind of doc goes. A new top-level category is added to it in the same commit.

### 9. All documentation lives in `docs/`

Documentation is prose for people about how the system works or how we work. Files that code reads at run time (schemas, fixtures, config) are not documentation. They stay next to the code that reads them.

### 10. Change the index with the doc

When you add, move, or delete a doc, update the `AGENTS.md` or `docs/README.md` that lists it in the same commit.

## Layout

```
docs/
  README.md
  ENGINEERING/
    ARCHITECTURE/            how the system is built
    CONVENTIONS/             rules for code, docs, and secrets
    RFCS/YYYY/MM/            design decisions
    PLANS/YYYY/MM/           implementation plans
    POST_MORTEMS/YYYY/MM/    incident write-ups
  TUTORIALS/                 step-by-step runbooks
  TEMPLATES/                 templates for new docs
```
