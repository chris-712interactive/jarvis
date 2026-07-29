import { extractWakeCommand } from "../apps/web/lib/speech/browser";

function assertEqual(actual: string, expected: string, label: string) {
  if (actual !== expected) {
    console.error(`FAIL ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok ${label}`);
}

function assert(condition: boolean, label: string) {
  if (!condition) {
    console.error(`FAIL ${label}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok ${label}`);
}

const leading = extractWakeCommand("Jarvis draft two plans for ForgeRep");
assert(leading.heard, "leading wake heard");
assertEqual(leading.command, "draft two plans for forgerep", "strip leading wake only");

const mid = extractWakeCommand("put this in the Jarvis Jobs folder");
assert(!mid.heard, "mid-sentence jarvis is not a wake");

const hey = extractWakeCommand("hey jarvis use ForgeRep");
assert(hey.heard, "hey jarvis heard");
assertEqual(hey.command, "use forgerep", "hey jarvis command");

console.log("wake extract checks done");
