# <Feature Name>, Implementation Plan

## Context

Describe the feature or change being implemented. Include the relevant RFC link if one exists, and state any key constraints upfront.

**RFC:** [RFC_<NAME>](../../../../RFCS/YYYY/MM/RFC_<NAME>/RFC_<NAME>.md)  
**Key constraint:** <any non-obvious constraint the implementer must know>

---

## Current Infrastructure

Describe the relevant existing code: what files exist today, what they do, and what is missing.

### <Relevant system or component>

- **Location:** `path/to/file.ts`
- **What it does:** ...
- **What it lacks:** ...

### What does not exist yet

- <missing piece 1>
- <missing piece 2>

---

## Architecture

### Data Model

```typescript
type ExampleType = {
  id: string
  // ...
}
```

### <Component or system design>

Describe the design with ASCII diagrams, component trees, or flow descriptions.

```
ComponentA
├── ComponentB
└── ComponentC
```

### Key Design Decisions

1. **Decision 1**, rationale
2. **Decision 2**, rationale

---

## Implementation Plan

### Phase 1: <Phase name>

**New files:**

| File | Description |
| --- | --- |
| `path/to/new-file.ts` | What this file does |

**Modified files:**

| File | Change |
| --- | --- |
| `path/to/existing-file.ts` | What changes |

### Phase 2: <Phase name>

*(Repeat as needed)*

---

## Files Summary

### New
- `path/to/file-a.ts`
- `path/to/file-b.ts`

### Modified
- `path/to/existing-file.ts`

### No changes needed
- `path/to/untouched-file.ts`, reason

---

## Verification

1. <Step to verify feature works end to end>
2. <Edge case to test>
3. <Another verification step>
