# JSM Open Tickets Viewer

Simple Node.js + Express app that fetches open Jira Service Management (JSM) tickets for a project and shows them in a minimal UI.

Quick start

1. Install Node.js (16+ recommended).
2. Copy `.env.example` to `.env` and set `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, and `JIRA_PROJECT` (default `HELP`).

```bash
cp .env.example .env
# edit .env
npm install
npm start
```

Open http://localhost:3000 in your browser.

Notes
- This app uses basic auth with an Atlassian API token. Create one at https://id.atlassian.com/manage-profile/security/api-tokens.
- The server proxies requests to the Jira REST API; do not commit your `.env`.
