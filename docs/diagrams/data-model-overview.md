# Data model: overview

Every row belongs to one user. A log only points at a food and holds an amount in grams; the nutrients live on `foods` and the server calculates them. Nothing is deleted through the tools: logs, workouts and foods are archived.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontFamily': 'ui-sans-serif, system-ui, sans-serif', 'fontSize': '14px', 'lineColor': '#64748b', 'primaryTextColor': '#0f172a'}}}%%
flowchart LR
    users["<b>users</b><br/>who you are and your time zone"]
    targets["<b>targets</b><br/>daily goals"]
    foods["<b>foods</b><br/>nutrients per 100 g<br/>also saved meals and Water"]
    fts["<b>foods_fts</b><br/>name search"]
    logs["<b>food_logs</b><br/>a food, grams and a meal"]
    workouts["<b>workouts</b><br/>a type, minutes, kcal and intensity"]
    requests["<b>request_log</b><br/>makes retries safe"]

    users -->|"has one"| targets
    users -->|"owns many"| foods
    users -->|"owns many"| logs
    users -->|"owns many"| workouts
    users -->|"owns many"| requests
    logs -->|"points at one"| foods
    foods -->|"indexed in"| fts

    classDef you fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#1e3a8a
    classDef code fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
    classDef data fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef outside fill:#ede9fe,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef auto fill:#f1f5f9,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    class users,targets you
    class foods code
    class logs,workouts data
    class fts outside
    class requests auto
```

All the fields are in [data model: all fields](data-model-fields.md). The schema itself is [`migrations/0001_schema.sql`](../../migrations/0001_schema.sql).

Colors: see the [legend](README.md#colors).
