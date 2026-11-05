# Sign-in

The first time an assistant connects, you sign in with GitHub. Only GitHub ids listed in `config/allowed-users.json` get through, and that list is checked again on every request.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontFamily': 'ui-sans-serif, system-ui, sans-serif', 'fontSize': '14px', 'lineColor': '#64748b', 'primaryTextColor': '#0f172a'}}}%%
sequenceDiagram
    autonumber
    actor You
    participant A as Assistant
    participant W as Your Worker
    participant GH as GitHub
    rect rgb(219, 234, 254)
        Note over You,W: 1. The assistant asks to connect
        A->>W: connect to /mcp
        W-->>A: 401, sign in at /authorize
        A->>You: open the sign-in page
        You->>W: /authorize
        W-->>You: consent screen: this app can read, add, edit and archive your data
        You->>W: Approve
    end
    rect rgb(237, 233, 254)
        Note over You,GH: 2. You sign in with GitHub
        W-->>GH: send you to GitHub
        You->>GH: sign in
        GH-->>W: /callback with a code
        W->>GH: read your numeric id and login
    end
    rect rgb(220, 252, 231)
        Note over W,A: 3. The server checks and issues a token
        Note over W: refused unless your id is on the allowed list
        W-->>A: token for your user
        A->>W: every later /mcp call carries the token<br/>(the allowed list is checked each time)
    end
```

The token is bound to your server's address and to your user, so it cannot be used anywhere else. Your GitHub access token is not kept.

Colors: see the [legend](README.md#colors).
