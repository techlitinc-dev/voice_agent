import { VaaniClient } from "./vaani";

async function main() {
  const vaani = new VaaniClient({
    apiKey: process.env.VAANI_API_KEY ?? "demo-api-key-do-not-use",
    baseUrl: process.env.VAANI_BASE_URL ?? "http://localhost:3000",
  });

  const calls = await vaani.listCalls({ limit: 5 });
  if (!calls.ok) {
    console.error("listCalls failed:", calls.error);
    process.exit(1);
  }
  console.log(`fetched ${calls.data.length} call(s); first id: ${calls.data[0]?.id ?? "none"}`);
}

main();
