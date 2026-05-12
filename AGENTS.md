# DiffMapper Agent Guidelines

## Patterns

- Use `Dry::Initializer` for all classes that take constructor arguments
- Keep rubocop happy. Don't disable cops inline — if it complains about method length or ABC complexity, refactor the code instead.
- Prefer real objects over mocks/stubs in tests. Build actual data rather than stubbing interfaces.
