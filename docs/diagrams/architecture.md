# Architecture

Who talks to whom. Everything in the green box runs in your own Cloudflare account; GitHub Actions only deploys and never serves requests.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontFamily': 'ui-sans-serif, system-ui, sans-serif', 'fontSize': '14px', 'lineColor': '#64748b', 'primaryTextColor': '#0f172a'}}}%%
flowchart LR
    U["You<br/>voice or chat"] --> C["Claude or your fave LLM<br/>MCP connector"]
    C -->|"MCP over HTTPS<br/>OAuth token"| W["<b>Worker</b> /mcp<br/>your Cloudflare account"]
    W --> D[("<b>D1</b><br/>your data")]
    W --> K[("<b>KV</b><br/>sign-in grants")]
    W -->|"find foods"| F["USDA and<br/>Open Food Facts"]
    C -.->|"first sign-in only"| G["GitHub<br/>identity only"]
    G -.-> W
    A["GitHub Actions"] -->|"test, create, migrate, deploy"| W

    classDef you fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#1e3a8a
    classDef code fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
    classDef data fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef outside fill:#ede9fe,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef auto fill:#f1f5f9,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    class U,C you
    class W code
    class D,K data
    class F,G outside
    class A auto
```

The assistant decides which tool to call. The server knows who you are from the sign-in token, does all the logic and nutrition math, and reads and writes your data. See [one tool call](tool-call.md) for what happens inside the Worker.

Colors: see the [legend](README.md#colors).
