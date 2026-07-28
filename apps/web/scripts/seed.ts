import { seedIfEmpty } from "../lib/db/queries";

async function main() {
  const result = await seedIfEmpty();
  console.log(result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
