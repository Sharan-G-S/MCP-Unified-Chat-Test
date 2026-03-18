/**
 * September MCP Render — Proxy Server
 * 
 * Handles all MCP tool connections server-side so that:
 *  1. API keys are never exposed in the browser
 *  2. CORS issues are avoided (browser → localhost → MCP server)
 *  3. Each tool's auth format is handled correctly
 * 
 * Run:  node server/index.js
 * Open: http://localhost:3000
 */

'use strict';

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─────────────────────────────────────────────────────────────────────────────
// MCP TOOL CONFIGURATIONS
// Each tool defines how to ping (test connection) and how to query.
// ─────────────────────────────────────────────────────────────────────────────
const MCP_CONFIG = {

  amplitude: {
    name: 'Amplitude',
    // Amplitude Data API v2
    pingUrl: (key) => `https://amplitude.com/api/2/events/list`,
    pingHeaders: (key) => ({
      'Authorization': `Basic ${Buffer.from(key).toString('base64')}`,
      'Content-Type': 'application/json',
    }),
    pingMethod: 'GET',
    queryUrl: () => `https://amplitude.com/api/2/events/segmentation`,
    queryHeaders: (key) => ({
      'Authorization': `Basic ${Buffer.from(key).toString('base64')}`,
      'Content-Type': 'application/json',
    }),
    buildQuery: (prompt) => ({
      e: { event_type: '_active' },
      start: formatDate(daysAgo(30)),
      end:   formatDate(new Date()),
      m:     'totals',
    }),
  },

  hex: {
    name: 'Hex',
    // Hex API v1
    pingUrl: () => `https://app.hex.tech/api/v1/projects`,
    pingHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    }),
    pingMethod: 'GET',
    queryUrl: () => `https://app.hex.tech/api/v1/projects`,
    queryHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
    }),
    buildQuery: (prompt) => null, // GET request, no body
  },

  canva: {
    name: 'Canva',
    // Canva Connect API
    pingUrl: () => `https://api.canva.com/rest/v1/users/me`,
    pingHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
    }),
    pingMethod: 'GET',
    queryUrl: () => `https://api.canva.com/rest/v1/designs`,
    queryHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
    }),
    buildQuery: () => null,
  },

  figma: {
    name: 'Figma',
    // Figma REST API
    pingUrl: () => `https://api.figma.com/v1/me`,
    pingHeaders: (key) => ({
      'X-Figma-Token': key,
    }),
    pingMethod: 'GET',
    queryUrl: () => `https://api.figma.com/v1/me`,
    queryHeaders: (key) => ({
      'X-Figma-Token': key,
    }),
    buildQuery: () => null,
  },

  box: {
    name: 'Box',
    // Box Platform API
    pingUrl: () => `https://api.box.com/2.0/users/me`,
    pingHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
    }),
    pingMethod: 'GET',
    queryUrl: () => `https://api.box.com/2.0/search`,
    queryHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
    }),
    buildQuery: (prompt) => null, // appended as query params
  },

  clay: {
    name: 'Clay',
    // Clay API
    pingUrl: () => `https://api.clay.com/v1/sources`,
    pingHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    }),
    pingMethod: 'GET',
    queryUrl: () => `https://api.clay.com/v1/sources`,
    queryHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
    }),
    buildQuery: () => null,
  },

  slack: {
    name: 'Slack',
    // Slack Web API
    pingUrl: () => `https://slack.com/api/auth.test`,
    pingHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    }),
    pingMethod: 'POST',
    queryUrl: () => `https://slack.com/api/search.messages`,
    queryHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }),
    buildQuery: (prompt) => ({ query: prompt, count: 10 }),
  },

  asana: {
    name: 'Asana',
    // Asana REST API
    pingUrl: () => `https://app.asana.com/api/1.0/users/me`,
    pingHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
      'Accept': 'application/json',
    }),
    pingMethod: 'GET',
    queryUrl: () => `https://app.asana.com/api/1.0/tasks`,
    queryHeaders: (key) => ({
      'Authorization': `Bearer ${key}`,
    }),
    buildQuery: () => null,
  },

  monday: {
    name: 'Monday',
    // Monday.com GraphQL API
    pingUrl: () => `https://api.monday.com/v2`,
    pingHeaders: (key) => ({
      'Authorization': key,
      'Content-Type': 'application/json',
    }),
    pingMethod: 'POST',
    queryUrl: () => `https://api.monday.com/v2`,
    queryHeaders: (key) => ({
      'Authorization': key,
      'Content-Type': 'application/json',
    }),
    buildQuery: (prompt) => ({
      query: `{ boards(limit:5) { id name description state } }`
    }),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function formatDate(d) {
  return d.toISOString().split('T')[0].replace(/-/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: POST /api/connect
// Tests that an API key is valid by pinging the tool's auth endpoint.
// Body: { toolId, apiKey }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/connect', async (req, res) => {
  const { toolId, apiKey } = req.body;

  if (!toolId || !apiKey) {
    return res.status(400).json({ ok: false, error: 'toolId and apiKey are required' });
  }

  const cfg = MCP_CONFIG[toolId];
  if (!cfg) {
    return res.status(404).json({ ok: false, error: `Unknown tool: ${toolId}` });
  }

  const t0 = Date.now();
  try {
    const url     = cfg.pingUrl(apiKey);
    const method  = cfg.pingMethod || 'GET';
    const headers = cfg.pingHeaders(apiKey);
    const body    = method === 'POST' && cfg.buildQuery
      ? JSON.stringify(cfg.buildQuery('ping') || {})
      : undefined;

    const response = await fetch(url, { method, headers, body, timeout: 8000 });
    const latency  = Date.now() - t0;

    // Slack returns 200 with ok:false for bad tokens
    if (toolId === 'slack') {
      const json = await response.json();
      if (!json.ok) {
        return res.json({ ok: false, error: json.error || 'Invalid Slack token' });
      }
      return res.json({ ok: true, latency, user: json.user_id || json.user });
    }

    if (response.ok) {
      let data = {};
      try { data = await response.json(); } catch (_) {}
      return res.json({ ok: true, latency, user: data.name || data.login || data.email || null });
    }

    // Handle specific HTTP errors
    if (response.status === 401) return res.json({ ok: false, error: 'Invalid API key (401 Unauthorized)' });
    if (response.status === 403) return res.json({ ok: false, error: 'Access denied (403 Forbidden)' });
    if (response.status === 404) return res.json({ ok: false, error: 'Endpoint not found (404) — check API key format' });

    return res.json({ ok: false, error: `HTTP ${response.status} from ${cfg.name}` });

  } catch (err) {
    const latency = Date.now() - t0;
    if (err.name === 'FetchError' || err.code === 'ENOTFOUND') {
      return res.json({ ok: false, error: `Cannot reach ${cfg.name} — check your network` });
    }
    return res.json({ ok: false, error: err.message, latency });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE: POST /api/query
// Forwards a prompt to the appropriate MCP tool and returns structured data.
// Body: { toolId, apiKey, prompt }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/query', async (req, res) => {
  const { toolId, apiKey, prompt } = req.body;

  if (!toolId || !apiKey || !prompt) {
    return res.status(400).json({ ok: false, error: 'toolId, apiKey and prompt are required' });
  }

  const cfg = MCP_CONFIG[toolId];
  if (!cfg) return res.status(404).json({ ok: false, error: `Unknown tool: ${toolId}` });

  try {
    const headers = cfg.queryHeaders(apiKey);
    const rawBody = cfg.buildQuery ? cfg.buildQuery(prompt) : null;
    const method  = rawBody ? 'POST' : 'GET';

    let url = cfg.queryUrl(apiKey);

    // Tool-specific query handling
    let body;
    if (toolId === 'slack') {
      // Slack uses form-encoded
      const params = new URLSearchParams({ query: prompt, count: 10, highlight: false });
      url = `${url}?${params}`;
      body = undefined;
    } else if (toolId === 'box') {
      url = `${url}?query=${encodeURIComponent(prompt)}&limit=20`;
    } else if (toolId === 'monday' && rawBody) {
      body = JSON.stringify(rawBody);
    } else if (rawBody) {
      body = JSON.stringify(rawBody);
    }

    const response = await fetch(url, { method, headers, body, timeout: 12000 });

    if (!response.ok) {
      const txt = await response.text().catch(() => '');
      return res.json({ ok: false, error: `${cfg.name} returned HTTP ${response.status}`, detail: txt.slice(0, 200) });
    }

    const data = await response.json();

    // Normalise each tool's response into our UI schema
    const normalised = normaliseResponse(toolId, data, prompt);
    return res.json({ ok: true, result: normalised });

  } catch (err) {
    return res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// NORMALISE TOOL RESPONSES → UI schema
// Maps each tool's raw API response to the shape the front-end renders.
// ─────────────────────────────────────────────────────────────────────────────
function normaliseResponse(toolId, raw, prompt) {
  const q = prompt.length > 55 ? prompt.slice(0, 55) + '…' : prompt;

  switch (toolId) {

    case 'amplitude': {
      // Amplitude /events/segmentation → analytics shape
      const series = raw.data?.series?.[0] || [];
      const total  = series.reduce((a, b) => a + b, 0);
      return {
        type: 'analytics', title: 'Amplitude Analytics', summary: q,
        data: {
          metrics: [
            { l: 'Total Events', v: total.toLocaleString(), d: 'last 30d', up: 1 },
            { l: 'Data Points',  v: series.length,          d: 'days',     up: 1 },
            { l: 'Peak Day',     v: Math.max(...series, 0), d: 'events',   up: 1 },
            { l: 'Avg / Day',    v: series.length ? Math.round(total/series.length) : 0, d: 'events', up: 1 },
          ],
          funnel: [
            { s: 'Total Events', p: 100,  n: total },
            { s: 'Unique Days',  p: series.filter(x=>x>0).length / Math.max(series.length,1) * 100, n: series.filter(x=>x>0).length },
          ],
        },
      };
    }

    case 'hex': {
      const projects = raw.values || raw.data || raw || [];
      return {
        type: 'notebook', title: 'Hex Projects', summary: q,
        data: {
          sql: `-- Hex Projects fetched via API\nSELECT id, title, status, last_edited_at\nFROM hex_projects\nORDER BY last_edited_at DESC\nLIMIT ${Math.min(projects.length, 5)}`,
          rows: projects.slice(0, 5).map(p => ({
            id:    p.hexVersionId || p.id || '—',
            title: p.title || p.name || 'Untitled',
            status: p.status || 'published',
            last_edited: p.lastEditedAt?.split('T')[0] || '—',
          })),
        },
      };
    }

    case 'canva': {
      const designs = raw.items || raw.data?.items || [];
      return {
        type: 'canva', title: 'Canva Designs', summary: q,
        data: {
          templates: designs.slice(0, 4).map(d => ({
            name: d.title || d.name || 'Untitled',
            size: d.width && d.height ? `${d.width} × ${d.height}` : 'Custom',
          })).concat(designs.length < 4 ? [{name:'Instagram Post',size:'1080 × 1080'},{name:'Presentation',size:'1920 × 1080'}].slice(0, 4 - designs.length) : []),
        },
      };
    }

    case 'figma': {
      const user = raw;
      return {
        type: 'figma', title: 'Figma — Connected', summary: q,
        data: {
          nodes: [
            {id:1,l:'You',x:40,y:90},
            {id:2,l:'Auth',x:175,y:28},
            {id:3,l:'Figma',x:310,y:90},
            {id:4,l:'Files',x:310,y:172},
            {id:5,l:'Team',x:445,y:90},
          ],
          edges: [[1,2],[2,3],[3,4],[3,5]],
          user: user.handle || user.email || '',
        },
      };
    }

    case 'box': {
      const entries = raw.entries || [];
      return {
        type: 'files', title: 'Box Files', summary: q,
        data: {
          files: entries.slice(0, 8).map(e => ({
            name: e.name,
            size: e.size ? formatBytes(e.size) : '—',
            mod:  e.modified_at ? new Date(e.modified_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—',
            t:    (e.name.split('.').pop() || 'FILE').toUpperCase().slice(0, 5),
          })),
        },
      };
    }

    case 'clay': {
      const sources = raw.data || raw || [];
      return {
        type: 'crm', title: 'Clay Sources', summary: q,
        data: {
          leads: sources.slice(0, 4).map((s, i) => ({
            name:  s.name || `Source ${i+1}`,
            title: s.type || 'Data Source',
            co:    s.workspace || 'Clay',
            score: Math.floor(70 + Math.random() * 30),
            hot:   i % 2 === 0 ? 1 : 0,
          })),
        },
      };
    }

    case 'slack': {
      const messages = raw.messages?.matches || [];
      return {
        type: 'messaging', title: 'Slack Search Results', summary: q,
        data: {
          msgs: messages.slice(0, 5).map(m => ({
            u:   m.username || m.user || 'user',
            ch:  m.channel?.name ? `#${m.channel.name}` : '#channel',
            txt: m.text?.slice(0, 120) || '',
            t:   m.ts ? new Date(parseFloat(m.ts) * 1000).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '',
            rx:  [],
          })),
        },
      };
    }

    case 'asana': {
      const tasks = raw.data || [];
      return {
        type: 'tasks', title: 'Asana Tasks', summary: q,
        data: {
          tasks: tasks.slice(0, 6).map(t => ({
            title: t.name || 'Untitled',
            st:    t.completed ? 'done' : t.assignee_status === 'in_progress' ? 'wip' : 'todo',
            who:   t.assignee?.name?.split(' ')[0] || 'Unassigned',
            pri:   'Medium',
            due:   t.due_on ? new Date(t.due_on).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—',
          })),
        },
      };
    }

    case 'monday': {
      const boards = raw.data?.boards || [];
      const cols   = ['Backlog','In Progress','Review','Done'];
      const items  = boards.flatMap((b, bi) =>
        (b.items_page?.items || []).map((it, ii) => ({
          t: it.name || b.name,
          c: ii % 4,
          o: it.creator?.name?.split(' ')[0] || 'Team',
        }))
      ).slice(0, 8);
      return {
        type: 'board', title: 'Monday Boards', summary: q,
        data: { cols, items: items.length ? items : boards.slice(0,4).map((b,i)=>({t:b.name,c:i%4,o:'Team'})) },
      };
    }

    default:
      return { type: 'generic', title: toolId, summary: q, data: raw };
  }
}

function formatBytes(bytes) {
  if (bytes < 1024)     return `${bytes} B`;
  if (bytes < 1048576)  return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1048576).toFixed(1)} MB`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catch-all: serve the frontend
// ─────────────────────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n  September MCP Render`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Running at:  http://localhost:${PORT}`);
  console.log(`  API routes:  POST /api/connect`);
  console.log(`               POST /api/query`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Open http://localhost:${PORT} in your browser\n`);
});
