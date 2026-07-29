import {
  appendSpeechFinal,
  collapseSpeechRepeats,
  sanitizeVoiceCommand,
} from "../apps/web/lib/speech/browser";

function assertEqual(actual: string, expected: string, label: string) {
  if (actual !== expected) {
    console.error(`FAIL ${label}\n  expected: ${expected}\n  actual:   ${actual}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok ${label}`);
}

assertEqual(
  collapseSpeechRepeats("for for for Forge for Forge for Forge"),
  "for Forge",
  "word + short phrase loop",
);

assertEqual(
  collapseSpeechRepeats("I need two plans I need two plans I need two plans"),
  "I need two plans",
  "sentence loop",
);

assertEqual(
  appendSpeechFinal("I need two", "I need two social"),
  "I need two social",
  "append extends",
);

assertEqual(
  appendSpeechFinal("hello world", "hello world"),
  "hello world",
  "append identical",
);

const messy =
  "hey for for for for Forge for Forge rep for Forge rep for Forge rep I for Forge rep I need for Forge rep I need for Forge rep I need two social media plans one for the actual brand that has a social media account for Forge rep I need two social media plans one for the actual brand that has a social media account for Forge rep I need two social media plans one for the actual brand";

const cleaned = sanitizeVoiceCommand(messy);
console.log("messy collapsed to:", cleaned);
if ((cleaned.match(/I need two social media plans/gi) ?? []).length > 1) {
  console.error("FAIL still has repeated long sentence");
  process.exitCode = 1;
} else {
  console.log("ok long forge sample collapsed");
}
