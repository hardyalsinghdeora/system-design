# Conventions for this repository

Three kinds of content, each with a fixed shape.

```
fundamentals/<concept>.md        one concept per file; template in fundamentals/_TEMPLATE.md
problems/<system>.md             one interview problem per file; template in problems/_TEMPLATE.md
src/<building-block>/            runnable TypeScript: <name>.ts, <name>.test.ts, demo.ts, README.md
docs/                            the interview framework and cheat sheets
```

Reference examples: `fundamentals/consistent-hashing.md`, `problems/url-shortener.md`, `src/consistent-hash-ring/`.

## Writing rules

- Follow the template sections exactly; do not drop the estimation table, the trade-offs table or the follow-up questions.
- Every number comes with its implication ("4,000 reads/s → one Redis node").
- Every deep dive is problem → 2-3 options → chosen option and *why*. Options without a choice read as indecision.
- Diagrams are Mermaid (`flowchart LR` for architecture, `sequenceDiagram` for request flows). Keep node labels short; quote labels that contain parentheses.
- Link related fundamentals, problems and building blocks with relative links. Only link files that exist (check the index in the README).
- Plain, direct prose. No marketing adjectives. Short paragraphs; tables for comparisons.

## Code rules

- Strict TypeScript, no `any`; `npm run typecheck` and `npm test` pass.
- Each building block is self-contained (no imports from other building blocks) and dependency-free (Node built-ins only).
- Time, randomness and ids are injectable so tests are deterministic.
- Tests prove the property the block exists for (e.g. token bucket refills at the configured rate; Bloom filter has zero false negatives and a bounded false-positive rate).
- `demo.ts` prints a short, readable story. `README.md` has the concept link, run commands, a 5-10 line usage snippet, and what the tests prove.
