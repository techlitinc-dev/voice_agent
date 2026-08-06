// Test-only HTTP sink for alert.sh verification. NOT used in production.
require("http")
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      console.log(`${req.method} ${req.url} ${body}`);
      res.end("ok");
    });
  })
  .listen(9876, () => console.log("mock webhook receiver on :9876"));
