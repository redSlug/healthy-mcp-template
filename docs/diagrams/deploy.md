# Deploy

What the Deploy workflow does when you click Run workflow, or on a push to `main` once the repository variable `DEPLOY_ENABLED` is `true`. Nothing is ever deployed from a laptop.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontFamily': 'ui-sans-serif, system-ui, sans-serif', 'fontSize': '14px', 'lineColor': '#64748b', 'primaryTextColor': '#0f172a'}}}%%
flowchart TD
    T["Trigger<br/>Run workflow, or push to main"] --> CI["Run the tests<br/>ci.yml"]
    CI --> CK["Check secrets, variables<br/>and the allowed users"]
    CK --> PR["Create the D1 database and KV<br/>namespace if missing<br/>scripts/provision.mjs"]
    PR --> RS["Check MCP_RESOURCE<br/>is an https address"]
    RS --> MG["Apply database migrations"]
    MG --> DP["Deploy the Worker<br/>and set its secrets"]
    DP --> SM["Smoke test<br/>waits until the server answers 401<br/>to a request without a token"]
    PR -.-> CF[("Cloudflare account")]
    MG -.-> CF
    DP -.-> CF
    SM --> OK["Your connector URL<br/>WORKER_URL/mcp"]

    classDef you fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#1e3a8a
    classDef code fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
    classDef data fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef outside fill:#ede9fe,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef auto fill:#f1f5f9,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    class T,CI,CK,PR,RS,MG,DP,SM auto
    class CF data
    class OK you
```

A failed check stops the run before anything changes. Only one deploy runs at a time.

Colors: see the [legend](README.md#colors).
