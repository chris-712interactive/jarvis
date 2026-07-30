import {
  getRepoSummary,
  listOpenPullRequests,
  parseGithubRepoUrl,
} from "../apps/web/lib/github/repo";

function assert(condition: boolean, label: string) {
  if (!condition) {
    console.error(`FAIL ${label}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok ${label}`);
}

async function main() {
  const parsed = parseGithubRepoUrl(
    "https://github.com/chris-712interactive/jarvis",
  );
  assert(parsed?.owner === "chris-712interactive", "parse owner");
  assert(parsed?.repo === "jarvis", "parse repo");

  const summary = await getRepoSummary(
    "https://github.com/chris-712interactive/jarvis",
  );
  assert(Boolean(summary.fullName), `summary ${summary.fullName}`);

  const prs = await listOpenPullRequests(
    "https://github.com/chris-712interactive/jarvis",
    5,
  );
  assert(Array.isArray(prs), `prs array (${prs.length})`);

  console.log("github adapter checks done");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
