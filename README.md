# Dev Project Tracker

A web app to track application-development projects: a dashboard of active projects (longest-running first), a completed-projects tab, category-wise analytics, and an admin panel for managing projects, categories, and statuses.

## Requirements

- **Node.js 22.5 or newer** (uses Node's built-in SQLite module). Check with `node -v`.
  Download from https://nodejs.org if needed.

## Setup

**No `npm install` needed** — this app has zero external dependencies (it uses Node's
built-in HTTP server and built-in SQLite). If a `node_modules` folder exists from an
earlier attempt, you can safely delete it.

Open a terminal in this folder.

(Optional) load some sample projects to explore the app:

```
node seed.js
```

Start the server:

```
node server.js
```

Then open **http://localhost:3000** in a browser.

> Node prints a one-line "ExperimentalWarning" for the built-in SQLite module — that's
> normal and safe to ignore. To hide it, start with `node --no-warnings server.js`.

### Running on a shared network

Other people on the same network can reach it at `http://<this-computer-ip>:3000`
(find the IP with `ipconfig` on Windows). Keep this machine running as the server.
To change the port: `set PORT=4000 && npm start` (Windows) or `PORT=4000 npm start`.

## Admin login

Editing (add/edit/delete projects, categories, statuses, people, status changes,
sub-owner transfers) requires the admin login. Viewing the dashboard, completed tab
and analytics is open to everyone.

- **Username:** `admin`
- **Password:** `Admin@123`

To change them, start with environment variables, e.g. on Windows:
`set ADMIN_USER=boss && set ADMIN_PASS=Secret#1 && node server.js`

## Features

- **Dashboard** — active projects sorted by total days from start (longest at top). Each row shows the status, a **live-ticking timer** for time from start and time in current status (days/hours/minutes/seconds), the current sub-owner, and days-to-complete. Filter by category (default *All*), status, sub-owner, or search.
- **Completed** — separate tab for completed projects, with a **Pull back** action (with date/time) to reopen a project into a correction / updates status.
- **Analytics** — theme-aware charts: projects per category, category share, average age, projects per sub-owner, and status distribution.
- **Admin** — add/edit/delete projects; manage categories; manage per-category statuses **including their sequence** (▲ ▼ reorder); manage the list of **owners & sub-owners**; mark statuses as *Completed* / *Pull-back*.
- **Scales to 500+ projects** — server-side filtering with a selectable page size (10/25/50/100/All), pager, sort options (longest running, newest, name, longest in status, days to complete) and a *search-in* field selector (all / name / number / company / client).
- **Logs** — an admin-only activity log of every change (create, edit, delete, status change, sub-owner transfer, reorder, login), searchable and filterable by action.
- **Light / dark theme** — toggle in the top bar (remembered per browser).
- **Sub-owner tracking** — owner and sub-owner are chosen from a managed people list. When a project is handed to a new sub-owner (a *Transfer*), the moment is recorded, so each project's detail view shows a **sub-owner timeline** with time spent and which statuses each person covered.

### Rules baked in

- Required project fields: **category, name, date, status**. All others optional.
- Duplicate project names are allowed — every project gets a backend-generated unique ID (UUID).
- Each category owns its own ordered status list. New categories start from the default set.
- Status changes and sub-owner transfers capture a date/time you can back-date.
- A category / status / person can't be deleted while projects still use it.

## Data

All data lives in `data/tracker.db` (SQLite). Back up that file to back up everything.

## Project structure

```
server.js        Express API + static hosting
db.js            SQLite schema + default seed (categories & statuses)
seed.js          Optional sample projects
public/          Frontend (index.html, css, js)
data/tracker.db  Database (created on first run)
```

## Default statuses

Requirement received · Requirement explained · Project started · Project paused ·
In-process corrections *(pull-back)* · Updates received from client *(pull-back)* ·
Installation completed · Project completed *(completed)*

Default categories: **VR, LMS, ARS, Custom** — all editable in Admin.
