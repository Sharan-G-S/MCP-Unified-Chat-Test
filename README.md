# September MCP Render v2

A unified chat interface that connects to **9 real MCP tool APIs** and renders rich UI directly in the chat.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start

# 3. Open in browser
open http://localhost:3000
```

---

## How It Works

```
Browser (public/index.html)
    │
    │  POST /api/connect  { toolId, apiKey }
    │  POST /api/query    { toolId, apiKey, prompt }
    ▼
Node Server (server/index.js)   ← your API keys never leave the server
    │
    ├─ Amplitude API  →  /api/2/events/segmentation
    ├─ Hex API        →  /api/v1/projects
    ├─ Canva API      →  /rest/v1/designs
    ├─ Figma API      →  /v1/me
    ├─ Box API        →  /2.0/search
    ├─ Clay API       →  /v1/sources
    ├─ Slack API      →  /api/search.messages
    ├─ Asana API      →  /api/1.0/tasks
    └─ Monday API     →  /v2  (GraphQL)
```

---

## Getting API Keys

| Tool      | Where to get your key |
|-----------|----------------------|
| **Amplitude** | Settings → Projects → [Your Project] → API Key + Secret Key (format: `apiKey:secretKey`) |
| **Hex** | hex.tech → Settings → API Keys → Generate new key |
| **Canva** | developers.canva.com → Create App → OAuth access token |
| **Figma** | figma.com → Settings → Personal access tokens → Generate |
| **Box** | developer.box.com → My Apps → Create App → Developer Token |
| **Clay** | clay.com → Settings → API → Create token |
| **Slack** | api.slack.com → Your Apps → OAuth & Permissions → Bot Token (`xoxb-…`) |
| **Asana** | app.asana.com → My Profile → Apps → Manage Developer Apps → Personal access token |
| **Monday** | monday.com → Avatar → Developers → My Access Tokens |

---

## Connecting a Tool

1. Start the server (`npm start`)
2. Open `http://localhost:3000`
3. Click **Connect** next to any tool in the sidebar
4. Paste your API key → hit **Connect [Tool]**
5. Green dot = you're live. Type a prompt.

---

## Using the Chat

- **Auto-detect**: Just type naturally. The system scores keywords and picks the best connected tool.
  - *"show me funnel metrics"* → Amplitude
  - *"find my files"* → Box
  - *"sprint tasks this week"* → Asana

- **@mention**: Force a specific tool:
  - `@slack search for deployment`
  - `@hex query DAU by country`
  - `@monday show project board`

---

## File Structure

```
September-MCP-Render/
├── server/
│   └── index.js        ← Express proxy + MCP connection handlers
├── public/
│   └── index.html      ← Full chat UI (calls /api/* routes)
├── package.json
└── README.md
```

---

## Customising Tool Queries

Open `server/index.js` and find the tool's entry in `MCP_CONFIG`. Edit:

- `queryUrl` — which endpoint to hit
- `queryHeaders` — auth format
- `buildQuery` — what payload to send based on the user's prompt

The `normaliseResponse` function maps each tool's raw API response to the UI renderer schema.

---

## Running on a Different Port

```bash
PORT=8080 npm start
```

---

## Deploying

This is a standard Express app. Deploy to:

- **Railway**: `railway up`
- **Render**: connect your repo, set start command to `npm start`  
- **Fly.io**: `fly launch`
- **Heroku**: `git push heroku main`

Set your `PORT` environment variable as needed.
