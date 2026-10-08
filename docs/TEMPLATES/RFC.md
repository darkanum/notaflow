# RFC: <Title>

**Status:** Draft | In Review | Approved | Implemented | Rejected  
**Date:** YYYY-MM-DD  
**Owner:** <name or team>

**References:**

- [Related RFC or doc](../../path/to/doc.md)

## Table of Contents

1. [Overview](#overview)
2. [Problem Statement](#problem-statement)
3. [Solution](#solution)
4. [Design](#design)
5. [Data Model](#data-model)
6. [File Locations](#file-locations)
7. [Open Questions](#open-questions)

---

## Overview

One or two paragraphs describing what this RFC covers. A reader unfamiliar with the context should understand the scope after reading this section.

---

## Problem Statement

What is broken, missing, or insufficient today? Be specific. Include the user-facing or system impact.

---

## Solution

High-level description of the proposed solution. Focus on the "what", not the "how" (leave implementation details for Design).

---

## Design

### <Sub-section 1>

Describe the approach in detail. Use diagrams, Mermaid charts, or ASCII trees where helpful.

```
Example component tree or flow:
ComponentA
├── ComponentB
│   └── ComponentC
└── ComponentD
```

### <Sub-section 2>

Continue with additional design sections as needed (API shape, state management, routing, etc.).

### Decision Matrix (optional)

| Approach | Pros | Cons |
| --- | --- | --- |
| Option A | ... | ... |
| Option B | ... | ... |

---

## Data Model

Describe any new or modified database tables, TypeScript types, or API payloads.

```typescript
type ExampleType = {
  id: string
  // ...
}
```

---

## File Locations

| File | Purpose |
| --- | --- |
| `path/to/file.ts` | Description |

---

## Open Questions

- [ ] Question or unresolved decision that needs input
- [ ] Another open question
