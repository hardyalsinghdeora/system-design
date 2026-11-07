# Design <System>

| | |
|---|---|
| **Asked at** | <companies / frequency> |
| **Difficulty** | Easy / Medium / Hard |
| **Core challenges** | <3-4 words each: e.g. hot keys, fan-out, contention> |
| **Related building blocks** | `src/<module>/` |

## 1. Requirements

### Functional
1. ...

### Non-functional
- Scale: ...
- Latency: ...
- Availability vs consistency: ...

### Out of scope
- ...

## 2. Estimation

| Quantity | Estimate | Implication |
|---|---|---|
| DAU | | |
| Writes/s | | |
| Reads/s | | |
| Storage / year | | |
| Cache size | | |

## 3. API

```
POST /v1/... 
GET  /v1/...
```

Idempotency, pagination, auth notes.

## 4. Data model

Tables / documents, keys, indexes, store choice and why.

## 5. High-level design

```mermaid
flowchart LR
```

Walk one request end to end.

## 6. Deep dives

### 6.1 <Hardest problem>
Problem → options (2-3) → chosen option and why.

### 6.2 ...

## 7. Scaling and operations

Partitioning, replication, caching, failure modes, monitoring.

## 8. Trade-offs summary

| Decision | Chosen | Alternative | Why |
|---|---|---|---|

## 9. Follow-up questions interviewers ask

- ...
