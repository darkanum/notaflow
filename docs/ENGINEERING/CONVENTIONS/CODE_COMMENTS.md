# Code Comments

Comments in NotaFlow exist to give the next reader, a teammate or an AI agent, the context the code cannot carry by itself. That makes them valuable and makes them expensive: an agent re-reads every comment in every file it opens, on every task, forever. A 12-line preamble that explains what the function signature already says is a cost paid on every future turn and buys nothing.

So: **write the comment that changes what the reader does. Cut everything else.**

## The budget

- **Default to one line.** A `/** … */` block over three lines has to earn itself.
- **A file header is at most a short paragraph.** If the design needs more, it needs a doc under `/docs` and a one-line pointer to it.
- **Never restate the code.** If the comment and the line below it say the same thing, delete the comment.
- **Put the long version where it belongs**: the commit message, the PR body, or a doc. Those are read once, by choice. Code comments are read every time.

## What earns a comment

| Earns it                          | Because                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------- |
| The non-obvious **why**           | The code shows what it does; nothing shows why it was allowed to.               |
| A constraint that will bite       | An ordering, a race, a module boundary, an import direction that lint enforces. |
| A pointer to the source of truth  | A copy deck, an RFC, a spec, one link beats a paraphrase that drifts.          |
| A unit or measure not in the name | `// px, not rem` next to a bare number.                                         |
| A deliberate absence              | Why something is NOT done here, so nobody "fixes" it back.                      |

## What does not

- Narrating the obvious (`// loop over the users`).
- A parameter list that repeats the types.
- Tutorial prose about the language or the framework.
- History and changelog (`// used to be X, changed in June`), that is `git log`.
- Reassurance (`// this is safe`, `// simple helper`).
- A `TODO` with no issue number. Open the issue, or delete the line.

## Examples

**Bad**, six lines to say what the type says, plus history:

```ts
/**
 * This field holds the access key of the invoice that was used as the
 * template. It is a string of 50 characters. It is null when the user
 * started from a customer instead of an invoice. It is set by the issue
 * flow and never by the sync. It was added so the review screen could
 * show what changed.
 */
templateOf: string | null
```

**Good**, one line, keeps only what the reader cannot infer:

```ts
/** Access key of the template invoice; null when the issue started from a customer. */
templateOf: string | null
```

**Good**, a block that earns its length, because the constraint is invisible in the code:

```ts
// Load the .pfx with node-forge, never with tls.createSecureContext: OpenSSL 3 refuses
// the legacy RC2 encryption that many e-CNPJ files still use.
```

## Applies to agents too

This is a rule for prompts as much as for code review. An agent asked to "explain the tricky part in a comment" should answer with one line and move the rest into the PR body. When you review AI-written code, treat an oversized comment as a defect like any other and cut it.

## Checklist

- [ ] Every comment says something the code cannot.
- [ ] No comment restates the line under it.
- [ ] Blocks over three lines justify their length, or the content moved to `/docs`, the commit, or the PR.
- [ ] No history, no reassurance, no issue-less `TODO`.
