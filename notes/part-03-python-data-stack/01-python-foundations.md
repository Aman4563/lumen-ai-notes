# Chapter 1 — Python Foundations and Language Semantics

## 1. How Python executes

Python names refer to objects. Assignment binds a name; it does not copy an object.

```python
a = [1, 2]
b = a
b.append(3)
assert a == [1, 2, 3]  # both names refer to the same list
```

Use this model:

```text
name a ─┐
        ├──> list object [1, 2, 3]
name b ─┘
```

`is` tests identity; `==` tests value equality. Use `is None`, not `== None`.

## 2. Core types

| Type | Mutable? | Ordered? | Typical use |
|---|---|---|---|
| `int`, `float`, `bool`, `complex` | no | n/a | numeric values |
| `str`, `bytes` | no | yes | text / binary data |
| `tuple` | no | yes | fixed records, hashable if elements hashable |
| `list` | yes | yes | dynamic sequence |
| `dict` | yes | insertion ordered | key-value lookup |
| `set` | yes | no semantic order | membership/uniqueness |
| `frozenset` | no | no semantic order | immutable set/hash key |

Python integers have arbitrary precision but slower/larger than fixed-width native
integers. Floats are usually IEEE-754 double precision and do not exactly
represent most decimals:

```python
0.1 + 0.2 == 0.3  # False
```

Use tolerances for scientific comparisons and `decimal.Decimal` for appropriate
exact decimal financial logic, with explicit rounding policies.

## 3. Truthiness and control flow

Falsy built-ins include `False`, `None`, numeric zero, and empty containers.
Do not collapse semantically distinct states accidentally:

```python
if value is None:
    ...  # missing specifically, not zero or empty
```

Short-circuiting:

```python
result = user is not None and user.is_active
fallback = configured_value or default_value  # wrong if 0 is valid
```

Structural pattern matching can express tagged shapes but should not replace
simple conditionals with cleverness.

## 4. Iterables, iterators, and generators

- Iterable: can produce an iterator via `iter(obj)`.
- Iterator: stateful object supporting `next()` until `StopIteration`.
- Generator: iterator created by `yield` or generator expression.

```python
def batches(items, size):
    if size <= 0:
        raise ValueError("size must be positive")
    batch = []
    for item in items:
        batch.append(item)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch
```

Generators stream data and reduce peak memory but are one-pass, stateful, and may
delay exceptions. Do not reuse an exhausted iterator by accident.

### Comprehensions

```python
squares = [x * x for x in values if x >= 0]
lookup = {record.id: record for record in records}
unique = {normalize(x) for x in values}
```

Prefer explicit loops when logic has multiple side effects/branches.

## 5. Functions and argument semantics

Python passes object references by assignment (“call by sharing”). A function can
mutate a passed mutable object but rebinding its local name does not rebind caller.

```python
def mutate(xs):
    xs.append(1)

def rebind(xs):
    xs = [1]  # local only
```

### Argument kinds

```python
def predict(model, features, /, *, threshold=0.5, return_score=False):
    ...
```

- before `/`: positional-only;
- after `*`: keyword-only;
- `*args`: extra positional tuple;
- `**kwargs`: extra keyword dict.

Keyword-only options make evolving APIs clearer.

### Mutable default trap

Defaults are evaluated once when `def` executes:

```python
def add(item, items=[]):       # bug: shared list
    items.append(item)
    return items

def add_safe(item, items=None):
    if items is None:
        items = []
    items.append(item)
    return items
```

### Closures and late binding

```python
funcs = [lambda i=i: i for i in range(3)]
```

Without `i=i`, closures look up the final loop value when called. Understand
closure cells before using function factories.

## 6. Scope and namespaces

Name lookup follows LEGB:

1. Local
2. Enclosing
3. Global/module
4. Built-ins

Avoid mutable global state. `global` and `nonlocal` are occasionally useful but
make dependencies/concurrency/testing harder. Pass dependencies explicitly.

## 7. Exceptions

Exceptions separate normal return values from failure paths.

```python
class ModelNotReadyError(RuntimeError):
    pass

def load_model(path):
    try:
        return deserialize(path)
    except OSError as exc:
        raise ModelNotReadyError(f"cannot load model from {path}") from exc
```

Guidelines:

- catch the narrowest expected exception;
- add useful context and preserve cause with `raise ... from exc`;
- do not swallow exceptions with bare `except`;
- do not use exceptions for common expected branching when a clear result type
  is better;
- clean up resources with context managers;
- convert internal errors to stable boundary errors without leaking secrets.

`try/except/else/finally`:

- `else` runs only if no exception;
- `finally` runs for cleanup even on return/error.

## 8. Context managers

They guarantee paired setup/cleanup:

```python
from contextlib import contextmanager

@contextmanager
def timer(record):
    start = time.perf_counter()
    try:
        yield
    finally:
        record(time.perf_counter() - start)
```

Files, database transactions, locks, temporary resources, and tracing spans should
use context managers. Cleanup must handle partial setup and exceptions.

## 9. Classes, composition, and data models

```python
from dataclasses import dataclass

@dataclass(frozen=True, slots=True)
class Prediction:
    score: float
    model_version: str
```

- `frozen=True` discourages mutation but is not a deep immutability/security
  boundary.
- `slots=True` can reduce memory and prevent accidental attributes.

Prefer composition over deep inheritance. Model behavior using small protocols/
interfaces and inject dependencies.

### Special methods

`__repr__`, `__eq__`, `__hash__`, `__iter__`, `__enter__`, and others integrate
objects with Python protocols. Preserve invariants: mutable objects used as dict
keys are dangerous because hashes must remain stable.

### Class versus instance attributes

Mutable class attributes are shared across instances. Initialize per-instance
state in `__init__` or dataclass fields with `default_factory`.

## 10. Type hints

Type hints improve design, tooling, and review but are not runtime validation by
default.

```python
from collections.abc import Iterable, Sequence
from typing import Protocol, TypeVar

class Scorer(Protocol):
    def score(self, features: Sequence[float]) -> float: ...

T = TypeVar("T")

def first(items: Sequence[T]) -> T:
    if not items:
        raise ValueError("empty sequence")
    return items[0]
```

Useful principles:

- accept abstract behavior (`Iterable`, protocol), return concrete useful types;
- distinguish `None` with `T | None`;
- use generics to preserve relationships, not to impress;
- validate external JSON/files separately;
- avoid `Any` leaking through the codebase.

## 11. Decorators

A decorator takes a callable and returns a callable.

```python
from functools import wraps

def traced(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        with trace_span(fn.__qualname__):
            return fn(*args, **kwargs)
    return wrapper
```

Use `wraps` to preserve metadata. Decorators can obscure control flow and typing;
prefer explicit wrappers when behavior/configuration is substantial.

## 12. Modules, packages, and imports

- Module: one Python file.
- Package: importable collection, often a directory.
- Distribution: installable artifact/project package.

Imports execute module top-level code once per process/module cache. Avoid heavy
work, network calls, or configuration validation at import time.

Circular imports signal misplaced responsibilities. Move shared abstractions,
depend on interfaces, or import locally only as a deliberate boundary.

Use absolute imports inside applications; control public API with package exports,
not wildcard imports.

## 13. Copying and serialization

- assignment: another reference;
- shallow copy: new outer container, shared nested objects;
- deep copy: recursively copies supported objects, potentially expensive/wrong for
  connections, locks, tensors, or shared identity.

Serialization formats:

- JSON: interoperable, limited types, validate schema;
- CSV: ambiguous types/escaping/schema;
- Parquet: columnar typed analytics;
- pickle: Python-specific and unsafe for untrusted input;
- model formats: version/runtime compatibility and security matter.

Never unpickle untrusted data; deserialization can execute code.

## 14. Memory management and garbage collection

CPython primarily uses reference counting plus cycle collection. An object remains
alive while references exist. Views, closures, caches, tracebacks, and global lists
can retain large arrays unexpectedly.

Generators reduce eager allocation, but a generator closing over a large object
can keep it alive. Measure resident memory and inspect references rather than
assuming `del` immediately returns memory to the OS.

## 15. Concurrency preview

- Threading: shared memory; useful for blocking I/O, with synchronization needs.
- Multiprocessing: separate processes; CPU parallelism with serialization/IPC cost.
- Async I/O: cooperative concurrency for many waiting operations; blocking calls
  stall the event loop.

The CPython GIL limits simultaneous Python bytecode execution in ordinary threads,
but native libraries can release it. Concurrency is not parallelism, and neither
guarantees faster code.

## 16. Logging and observability

Prefer structured fields over string concatenation:

```python
logger.info(
    "prediction_complete",
    extra={"model_version": version, "latency_ms": latency_ms},
)
```

Never log secrets, raw sensitive features, or unrestricted generated content.
Include request/trace IDs, versions, outcome status, and bounded diagnostic fields.
Metrics summarize; logs explain cases; traces connect distributed steps.

## 17. Performance

Measure with a profiler. Common improvements:

1. better algorithm/data structure;
2. avoid repeated I/O/parsing/serialization;
3. vectorize numeric work;
4. batch remote/model calls;
5. cache with explicit invalidation/bounds;
6. move hot loops to optimized libraries;
7. parallelize only after bottleneck and contention analysis.

Micro-optimizing Python syntax rarely beats changing O(n²) to O(n log n).

## 18. Clean-function checklist

- clear name and single responsibility;
- explicit inputs/outputs and units/shapes;
- validated external boundary;
- deterministic core where possible;
- no hidden global mutation;
- narrow exceptions with context;
- tests for normal, edge, and error cases;
- complexity appropriate to scale;
- observable without leaking data;
- documentation states contract, not line-by-line narration.

## 19. Exercises

### Beginner

1. Predict output of aliasing, shallow-copy, and default-argument examples.
2. Write a generator yielding fixed-size batches.
3. Create a validated dataclass for a model request.
4. Write a context manager for a temporary configuration override.

### Intermediate

1. Implement an LRU cache, then compare with the standard library.
2. Define a `Protocol` for sync and async model scorers.
3. Refactor global state into injected dependencies.
4. Diagnose why a closure returns the final loop variable.

### Advanced/interview

1. Explain Python mutability, identity, hashing, and dict-key invariants.
2. Compare threads, processes, and async for an inference gateway.
3. Find a memory retention problem involving NumPy views/generator closures.
4. Design stable exceptions and retries around a feature-service client.

