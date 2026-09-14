# Untitled Grid

A design tool with no user. An infinite modular grid where every click is a rule, and every rule spreads — into the canvas, then into the interface itself. Earlier visitors return as ghost cursors.

Plain HTML, CSS and JavaScript. No build step, no server.

## Run locally

Open `index.html` in a browser.

## Structure

| File | Role |
|---|---|
| `js/core.js` | Seeded world, modules, rules, propagation, move encoding |
| `js/render.js` | Canvas renderer: construction layer, glyphs, fusion, overlays |
| `js/app.js` | Input, panels, history, erosion of the interface, sharing |
| `js/ghosts.js` | Recorded sessions, ghost replay, live cursors |
| `data/ghosts.json` | Archive of recorded sessions every visitor can meet |

## Publish on GitHub Pages (free, browser only)

1. Sign in at github.com and create a new **public** repository, e.g. `untitled-grid`.
2. On the empty repository page, choose **uploading an existing file**.
3. Drag in everything inside this folder (`index.html`, `style.css`, `README.md`, `js/`, `data/`) and press **Commit changes**.
4. Open **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, then **Save**.
5. After a minute the site is live at `https://<your-username>.github.io/untitled-grid/`.

To update the site later, upload the changed files again the same way.

## Where ghosts come from

- **`data/ghosts.json`** — recorded sessions shipped with the site. Every visitor meets them.
- **The visitor's own browser** — their earlier sessions return as "earlier you".
- **Inside a claude.ai artifact** — sessions are shared between viewers automatically, and people viewing at the same time see each other's cursors.

GitHub Pages cannot store anything, so new sessions from public visitors stay in their own browsers, and live cursors between strangers are not available there.
