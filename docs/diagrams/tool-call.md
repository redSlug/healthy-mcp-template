# One tool call

What happens inside the Worker when the assistant calls a tool. The assistant sends JSON arguments; the server keeps the data as plain objects all the way through and writes the reply sentence only at the very end.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontFamily': 'ui-sans-serif, system-ui, sans-serif', 'fontSize': '14px', 'lineColor': '#64748b', 'primaryTextColor': '#0f172a'}}}%%
flowchart TD
    L["Assistant<br/>Claude or your fave LLM"] -->|"1. JSON arguments"| T["<b>src/tools</b><br/>check the shape with zod"]
    T --> S["<b>src/services</b><br/>rules and nutrition math<br/>works on plain objects"]
    S --> Q["<b>src/data</b><br/>the only SQL<br/>always scoped to your user"]
    Q <--> DB[("<b>D1</b><br/>your data")]
    Q -->|"an object, for example<br/>log_ids and the day's totals"| S
    S --> R["<b>respond()</b><br/>writes one sentence<br/>from the object"]
    R -->|"2. text reply<br/>with ids and numbers in it"| L

    classDef you fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#1e3a8a
    classDef code fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
    classDef data fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef outside fill:#ede9fe,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef auto fill:#f1f5f9,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    class L you
    class T,S,Q,R code
    class DB data
```

The user is never an input: it comes from the sign-in token. The assistant reads the text reply, so every id and number it needs must be in that text.

Colors: see the [legend](README.md#colors).
