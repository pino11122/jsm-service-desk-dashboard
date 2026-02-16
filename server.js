const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config({ override: true });

const app = express();
app.use(cors());
app.use(express.json());

const JIRA_BASE = process.env.JIRA_BASE_URL;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_TOKEN = process.env.JIRA_API_TOKEN;
const JIRA_PROJECT = process.env.JIRA_PROJECT || 'HELP';

if (!JIRA_BASE || !JIRA_EMAIL || !JIRA_TOKEN) {
  console.warn('Warning: Missing JIRA configuration in environment. See .env.example');
}

function authHeader() {
  const token = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
  return { Authorization: `Basic ${token}`, 'Accept': 'application/json' };
}

app.get('/api/issues', async (req, res) => {
  try {
    const baseUrl = JIRA_BASE.replace(/\/$/, '');
    const url = `${baseUrl}/rest/api/3/search/jql`;
    const commonHeaders = Object.assign({}, authHeader(), { 'Content-Type': 'application/json' });

    const openJql = `project = ${JIRA_PROJECT} AND statusCategory != Done ORDER BY updated DESC`;
    const resolvedJql = `project = ${JIRA_PROJECT} AND statusCategory = Done ORDER BY updated DESC`;

    // Fetch open and recently resolved issues in parallel
    const [openResponse, resolvedResponse] = await Promise.all([
      axios.post(url, {
        jql: openJql,
        fields: [
          'summary', 'status', 'assignee', 'issuetype', 'priority',
          'description', 'created', 'updated', 'comment', 'resolutiondate'
        ],
        maxResults: 100
      }, { headers: commonHeaders }),
      axios.post(url, {
        jql: resolvedJql,
        fields: ['created', 'resolutiondate', 'statuscategorychangedate', 'comment'],
        maxResults: 100
      }, { headers: commonHeaders })
    ]);

    function enrichIssue(issue) {
      const created = issue.fields && issue.fields.created ? new Date(issue.fields.created) : null;
      const comments = issue.fields && issue.fields.comment && issue.fields.comment.comments ? issue.fields.comment.comments : [];
      let firstComment = null;
      if (comments.length > 0) {
        firstComment = comments.reduce((earliest, c) => {
          const cDate = c && c.created ? new Date(c.created) : null;
          if (!cDate) return earliest;
          if (!earliest) return cDate;
          return cDate < earliest ? cDate : earliest;
        }, null);
      }
      const timeToFirstMs = (created && firstComment) ? Math.max(0, firstComment.getTime() - created.getTime()) : null;
      const resolutionDate = issue.fields && issue.fields.resolutiondate ? new Date(issue.fields.resolutiondate)
        : issue.fields && issue.fields.statuscategorychangedate ? new Date(issue.fields.statuscategorychangedate)
        : null;
      const timeToResolutionMs = (created && resolutionDate) ? Math.max(0, resolutionDate.getTime() - created.getTime()) : null;
      return Object.assign({}, issue, { firstCommentAt: firstComment ? firstComment.toISOString() : null, timeToFirstMs, timeToResolutionMs, resolvedAt: resolutionDate ? resolutionDate.toISOString() : null });
    }

    const issues = (openResponse.data.issues || []).map(enrichIssue);
    const resolvedIssues = (resolvedResponse.data.issues || []).map(enrichIssue);

    // Avg time to first response (all time) — from open issues
    const ttrValues = issues.map(i => i.timeToFirstMs).filter(x => x != null);
    const avgTTRMs = ttrValues.length ? Math.round(ttrValues.reduce((a,b)=>a+b,0)/ttrValues.length) : null;

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    // Avg time to first response (7d) — from open issues created in last 7 days
    const recentTtrs = issues.filter(i => {
      if (!i.fields || !i.fields.created) return false;
      const created = new Date(i.fields.created).getTime();
      return (now - created) <= sevenDaysMs && i.timeToFirstMs != null;
    }).map(i => i.timeToFirstMs);
    const avgTTR7dMs = recentTtrs.length ? Math.round(recentTtrs.reduce((a,b)=>a+b,0)/recentTtrs.length) : null;

    // Avg time to resolution (7d) — from resolved issues resolved in last 7 days
    const recentResolutions = resolvedIssues.filter(i => {
      if (!i.resolvedAt) return false;
      const resolved = new Date(i.resolvedAt).getTime();
      return (now - resolved) <= sevenDaysMs && i.timeToResolutionMs != null;
    }).map(i => i.timeToResolutionMs);
    const avgTimeToResolution7dMs = recentResolutions.length ? Math.round(recentResolutions.reduce((a,b)=>a+b,0)/recentResolutions.length) : null;

    // Avg time to resolution (all time) — from all resolved issues in last 30 days
    const allResolutions = resolvedIssues.filter(i => i.timeToResolutionMs != null).map(i => i.timeToResolutionMs);
    const avgTimeToResolutionMs = allResolutions.length ? Math.round(allResolutions.reduce((a,b)=>a+b,0)/allResolutions.length) : null;

    res.json({
      browseBase: baseUrl,
      issues,
      avgTTRMs,
      avgTTR7dMs,
      avgTimeToResolutionMs,
      avgTimeToResolution7dMs
    });
  } catch (err) {
    console.error(err && err.response ? err.response.data : err.message);
    res.status(err && err.response && err.response.status ? err.response.status : 500).json({ error: 'Failed to fetch issues', details: err && err.response ? err.response.data : err.message });
  }
});

app.use(express.static('public'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
