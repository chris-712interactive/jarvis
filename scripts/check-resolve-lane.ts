function normalizeLaneKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function assert(condition: boolean, label: string) {
  if (!condition) {
    console.error(`FAIL ${label}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok ${label}`);
}

assert(normalizeLaneKey("ForgeRep") === "forgerep", "ForgeRep key");
assert(normalizeLaneKey("Forge Rep") === "forgerep", "Forge Rep key");
assert(normalizeLaneKey("forge-rep") === "forgerep", "forge-rep key");
assert(
  normalizeLaneKey("The Carline Dad") === "thecarlinedad",
  "Carline Dad key",
);

console.log("resolve-lane normalize checks done");
