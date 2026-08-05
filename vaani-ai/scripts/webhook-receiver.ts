/** Local test receiver: verifies X-Vaani-Signature and logs deliveries. */
import { createServer } from "node:http";
import { verifyWebhookSignature } from "../src/lib/webhook-sign";

const SECRET = process.env.RECEIVER_SECRET ?? "whsec_e2e_test_secret";
const PORT = Number(process.env.RECEIVER_PORT ?? 4777);

createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const sig = req.headers["x-vaani-signature"] as string | undefined;
    const event = req.headers["x-vaani-event"] as string | undefined;
    const valid = sig ? verifyWebhookSignature(SECRET, body, sig) : false;
    console.log(`RECEIVED event=${event} signature_valid=${valid} body=${body.slice(0, 200)}`);
    res.writeHead(valid ? 200 : 400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: valid }));
  });
}).listen(PORT, () => console.log(`receiver on :${PORT} secret=${SECRET}`));
