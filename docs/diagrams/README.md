# Diagrams

One file per diagram, so each can be linked and reused. They all share the same palette and font.

| Diagram | Shows |
|---|---|
| [Architecture](architecture.md) | who talks to whom |
| [One tool call](tool-call.md) | what happens inside the Worker |
| [Sign-in](sign-in.md) | how you sign in with GitHub |
| [Deploy](deploy.md) | what the Deploy workflow does |
| [Data model: overview](data-model-overview.md) | the tables and how they connect |
| [Data model: all fields](data-model-fields.md) | every column |

## Colors

The same five colors mean the same thing in every diagram.

| Color | Means |
|---|---|
| Blue | you, your assistant, and the people-side of the data (`users`, `targets`) |
| Green | our code that runs in your Worker (and the `foods` tables, the heart of the data) |
| Amber | stored data: D1, KV, logs and workouts |
| Purple | services outside the project: GitHub, USDA, Open Food Facts, search |
| Gray | automation and bookkeeping: GitHub Actions, the deploy steps, `request_log` |

The "all fields" data model is a Mermaid ER diagram, because that format lists columns left-aligned and readable. It cannot color tables one by one, so every table is amber (stored data), using theme settings in its `init` line.

When you add or change a diagram, copy the `init` line and the `classDef` lines from an existing file so they stay matching.
