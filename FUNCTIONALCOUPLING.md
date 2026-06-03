# Functional Coupling Guide (for Code Agents)

## Principle

A concept is a group of data and operations whose internal co-usage is
stronger than their external co-usage.

Group data that repeatedly appear together across operations. Do not
merge elements that are often used independently. Judge cohesion
globally, not per function. Aim for a dependency DAG (directed acyclic graph) of concepts: concepts may depend on other concepts, but not cyclically. Treat broad functions that touch several concepts as composition points, not as defining concepts.

A well-structured program should form a **dependency DAG of concepts**:
- each concept has strong internal cohesion,
- dependencies between concepts are explicit and controlled,
- cycles between peer concepts should be avoided.

## Procedure

1. Identify the data used by the relevant operations.
2. Detect recurring parameter groups and recurring groups of fields used together.
3. Introduce a concept for each stable group with strong internal co-usage and weak separate external usage.
4. Keep separate what is often used independently.
5. Treat functions that touch several concepts as orchestration or composition points unless they reveal a stable new grouping.
6. Rewrite signatures to reflect the concepts that emerged.
7. Organize the resulting concepts as a dependency DAG rather than a mesh of mutual access.
8. Do not introduce a concept for data that appears in only one operation or that is never repeated across signatures — avoid over-abstraction.

## Boundary rules

- Do not create concepts from thematic similarity alone.
- Do not merge elements that are often used independently.
- Do not let two concepts depend on each other's internals.
- Prefer one-way dependencies between concepts.
- If two modules depend on each other, re-evaluate the boundary: they may need to be merged, split differently, or factored through a third concept.

## Validation

A concept is well-bounded if:

- it reduces repeated parameter lists,
- it is mostly used as a unit,
- it passes the documentation test (see [Documentation](#documentation)).

A design is well-structured if:

- concepts are cohesive internally,
- cross-concept interactions are limited and explicit,
- the dependency graph between concepts remains acyclic.

## Grouping levels

The same coupling criterion — internal co-usage stronger than external co-usage — applies at every level of code organization. A concept materializes through the mechanism that matches its scope.

### Type

Groups fields that repeatedly co-appear in operation signatures. This is the finest-grained mechanism.

**Test:** Do these fields appear together in several operations? Are they rarely passed separately?

### Class

Groups data with the operations that primarily access it. In a functional style, this level may be replaced by a type together with a set of functions in the same file.

**Test:** Do the operations mainly access internal data? If they mostly reach outward, the class boundary may be wrong.

### File

Groups types and functions that are typically imported and used together.

**Test:** When this file is imported, is most of what it exports actually used? Or does the consumer cherry-pick a small fragment?

### Folder

Groups files that form a cohesive subsystem. Internal references between files in the folder should dominate external references.

**Test:** Do the files in this folder reference each other more than they reference the outside?

### Cross-level rules

- The boundary rules and DAG constraint apply at every level: no cycles between peer folders, no mutual dependencies between peer files, etc.
- The choice of level is itself a coupling judgment. If a type is always accompanied by the same functions and nothing else, it may warrant its own file rather than living inside a larger one.

## Documentation

Documentation serves two distinct roles within the Functional Coupling approach.

### Helping humans understand and navigate the code

Each concept, at every grouping level, should carry documentation that states:

- **What it represents** — the purpose of the concept in domain terms.
- **How it works** — the key mechanisms, invariants, or constraints.

This documentation helps developers locate the right concept when exploring unfamiliar code and understand its boundaries without reading every operation.

At the file and folder levels, a brief header or README describing the concept and its dependencies in the DAG serves as a navigation aid.

### Validating the grouping

Documentation also acts as a **litmus test** for cohesion. If a concept can be described simply and concisely — in one or two sentences — the grouping is likely sound. If the description requires long enumerations, multiple unrelated concerns, or excessive qualifications, it is a signal that the concept may need to be split.

In short:

- **Easy to document → good grouping.** The concept has a clear identity.
- **Hard to document → suspect grouping.** The boundary probably cuts across concerns rather than along them.

This test applies at every level: a type, a class, a file, or a folder that resists brief description is a candidate for restructuring.

## Example

Before:

```ts
function trim(samples, markers, start, end) { ... }
function normalize(samples, markers, gain) { ... }
function exportAudio(samples, markers, format) { ... }
```

After:

```ts
type Track = {
  samples: Samples
  markers: Markers
}

function trim(track, start, end) { ... }
function normalize(track, gain) { ... }
function exportAudio(track, format) { ... }
```

This is valid even if an operation later uses only part of the concept internally:

```ts
function normalize(track, gain) {
  adjustSamples(track.samples, gain)
  alignMarkers(track.markers)
}
```

The criterion is global co-usage across operations, not uniform field usage in every single function.

### Grouping-level example

The same `Track` concept can drive decisions at multiple levels:

- **Type level:** `Track = { samples, markers }` — fields grouped because they co-appear across `trim`, `normalize`, `exportAudio`.
- **File level:** `track.ts` exports `Track`, `trim`, `normalize`, `exportAudio` — consumers always import these together.
- **Folder level:** if `Track` grows to include `effects.ts` and `encoding.ts` that mainly reference each other and `track.ts`, a `track/` folder is warranted. If `encoding.ts` is used independently by other subsystems, it stays outside.

# Functional Coupling Checklist

## Before grouping

- Are these data often used together across several operations?
- Are they rarely used separately?
- Does this grouping reduce repeated signatures?
- Can the proposed concept be described simply in one or two sentences?

## Before merging

- Are some elements frequently used alone elsewhere?
- Is this grouping driven only by one large orchestration function?
- Would merging create a concept with weak internal cohesion?
- Would the merged concept be hard to describe concisely?

## DAG check

- Does this concept depend on another concept in a one-way manner?
- Is there any mutual dependency between peer concepts?
- If there is a cycle, should the concepts be merged, split differently, or factored through an intermediate concept?

## After refactoring

- Is the concept cohesive?
- Is it mostly manipulated as a unit?
- Can it be described clearly by what it represents and how it works?
- Is the documentation concise and self-sufficient? If not, the boundary may need revision.
- Does the overall design still form an acyclic dependency graph of concepts?
