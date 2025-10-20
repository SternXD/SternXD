// SPDX-Copyright: 2025 SternXD
// SPDX-License-Identifier: GPL-3.0+

import fs from "fs";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) throw new Error("Missing GITHUB_TOKEN environment variable");

const username = "SternXD";
const API_BASE = "https://api.github.com";

async function ghRequest(path, params = {}) {
  const url = new URL(API_BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, String(v)));
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

async function fetchMergedPRs() {
  let page = 1;
  const all = [];
  while (true) {
    const data = await ghRequest("/search/issues", {
      q: `author:${username} is:pr is:merged`,
      per_page: 100,
      page,
    });
    all.push(...(data.items || []));
    if (!data.items || data.items.length < 100) break;
    page++;
  }
  return all;
}

async function getRepo(owner, repo) {
  return ghRequest(`/repos/${owner}/${repo}`);
}

function formatDate(s) {
  return new Date(s).toISOString().split("T")[0];
}

async function main() {
  console.log("Fetching merged PRs for", username);
  const allPRs = await fetchMergedPRs();

  const repoMap = new Map();
  for (const pr of allPRs) {
    const parts = pr.repository_url.split("/").slice(-2);
    const repoFullName = parts.join("/");
    const [owner, repo] = parts;

    if (!repoMap.has(repoFullName)) {
      const repoData = await getRepo(owner, repo).catch(() => null);
      if (!repoData || repoData.private) continue;
      repoMap.set(repoFullName, { url: repoData.html_url, prs: [] });
    }

    repoMap.get(repoFullName).prs.push({
      title: pr.title,
      url: pr.html_url,
      merged: formatDate(pr.closed_at),
    });
  }

  const sortedRepos = Array.from(repoMap.entries()).sort((a, b) => {
    const aLast = new Date(a[1].prs[0].merged);
    const bLast = new Date(b[1].prs[0].merged);
    return bLast - aLast;
  });

  let md = `# Contributions\n\nThis page is automatically updated with all **public** merged pull requests by [@${username}](https://github.com/${username}).\nTotal public PRs merged: **${Array.from(repoMap.values()).reduce((s, r) => s + r.prs.length, 0)}**\n\n---\n\n`;

  for (const [repoName, data] of sortedRepos) {
    md += `## [${repoName}](${data.url})\n`;
    const sortedPRs = data.prs.sort((a, b) => new Date(b.merged) - new Date(a.merged));
    for (const pr of sortedPRs) {
      md += `- [${pr.title}](${pr.url}) _(merged ${pr.merged})_\n`;
    }
    md += "\n";
  }

  try {
    fs.mkdirSync("docs", { recursive: true });
    const outPath = "docs/contributions.md";
    fs.writeFileSync(outPath, md);
    console.log(`${outPath} updated successfully`);
  } catch (writeErr) {
    console.error("Failed to write contributions file:", writeErr && writeErr.message ? writeErr.message : String(writeErr));
    if (process.env.DEBUG) console.error(writeErr.stack || "no stack available");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Script failed:", err && err.message ? err.message : String(err));
  if (process.env.DEBUG) console.error(err.stack || "no stack available");
  process.exit(1);
});
