// Load test: public API throughput (scalability doc §6.2).
// Target: 500 RPS sustained, p95 < 200ms, < 1% errors.
//
// Run: k6 run -e BASE_URL=https://app.vaani.ai -e API_KEY=vaani_xxx tests/load/calls-api.k6.js
import http from "k6/http";
import { check } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 100 },  // ramp up
    { duration: "2m", target: 100 },    // hold
    { duration: "30s", target: 500 },   // spike
    { duration: "1m", target: 500 },
    { duration: "30s", target: 0 },     // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<200"],
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/api/v1/calls`, {
    headers: { Authorization: `Bearer ${__ENV.API_KEY}` },
  });
  check(res, { "status 200": (r) => r.status === 200 });
}
