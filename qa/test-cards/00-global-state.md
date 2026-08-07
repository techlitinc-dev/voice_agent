# Test Card 00 — Global State & Chain Map

Serves as the master state register for the entire automated suite. Every phase
chain-links here. The `NEXT TEST ID` on every card resolves to a card in this
document. The chain is **unbroken**: P1-T01 → P7-T03 (final).

---

## 1. TEST CARD: Global → Setup → GS-SETUP

- **1. TRIGGER** : `./qa/orchestrator.sh` starts; `RUN_SETUP=true` (default).
- **2. PRE-CONDITIONS** : Host has `node`, `npm`, `docker`, `jq`, `curl`. Ports 3000, 3001, 8000 free. Git repo at `/root/voice_agent`.
- **3. AI INSTRUCTIONS** : Execute `qa/scripts/setup-env.sh` then `qa/scripts/verify-clean.sh`. IF either exits non-zero THEN exit 2 (BLOCKED, no tests run).
- **4. INPUT DATA** : none (env-driven).
- **5. EXPECTED OUTPUT** :
  - ASSERT exit_code == 0 for both scripts
  - ASSERT `echo SETUP_OK` == present in setup output
  - ASSERT `echo CLEAN_OK` == present in verify output
- **6. CLEANUP** : none (idempotent; infra left running for later phases).
- **7. NEXT TEST ID** : P1-T01.

## 2. TEST CARD: Global → Chain Integrity → GS-CHAIN

- **1. TRIGGER** : After GS-SETUP passes.
- **2. PRE-CONDITIONS** : `qa/state/` exists.
- **3. AI INSTRUCTIONS** : Run `grep -r "NEXT TEST ID" qa/test-cards/ | sort` and verify every ID resolves to an existing card header. Verify no card has an empty `NEXT TEST ID`.
- **4. INPUT DATA** : none.
- **5. EXPECTED OUTPUT** :
  - ASSERT count_of_grep_lines == count_of_card_files × 1
  - ASSERT no "NEXT TEST ID : —" (empty) present
- **6. CLEANUP** : none.
- **7. NEXT TEST ID** : P1-T01.

## 3. TEST CARD: Global → Teardown → GS-TEARDOWN

- **1. TRIGGER** : Final card of Phase 7 (P7-T03) completes.
- **2. PRE-CONDITIONS** : All phases executed.
- **3. AI INSTRUCTIONS** : Execute `qa/scripts/verify-clean.sh`. Kill any orphaned test servers on ports 3000/8000. Optionally `docker compose -f vaani-ai/docker-compose.yml down` (data volume preserved).
- **4. INPUT DATA** : none.
- **5. EXPECTED OUTPUT** :
  - ASSERT no_listener_on_port_3000 == true
  - ASSERT no_listener_on_port_8000 == true
  - ASSERT `qa/state/report.json` exists and `go_no_go` field is either GO or NO-GO
- **6. CLEANUP** : n/a (this IS the teardown).
- **7. NEXT TEST ID** : END (chain terminates).

---

## CHAIN MAP (unbroken sequence)

| ID | Phase | Module | Next |
|----|-------|--------|------|
| P1-T01 | 1 | vaani-ai billing | P1-T02 |
| P1-T02 | 1 | vaani-ai auth | P1-T03 |
| P1-T03 | 1 | vaani-ai campaign | P1-T04 |
| P1-T04 | 1 | dograh auth | P1-T05 |
| P1-T05 | 1 | dograh workflow | P1-T06 |
| P1-T06 | 1 | dograh MCP | P2-T01 |
| P2-T01 | 2 | dograh→vaani contract | P2-T02 |
| P2-T02 | 2 | webhook handshake | P2-T03 |
| P2-T03 | 2 | queue/event flow | P2-T04 |
| P2-T04 | 2 | PII boundary | P3-T01 |
| P3-T01 | 3 | auth journey | P3-T02 |
| P3-T02 | 3 | agent/campaign journey | P3-T03 |
| P3-T03 | 3 | analytics/retention journey | P4-T01 |
| P4-T01 | 4 | latency (health) | P4-T02 |
| P4-T02 | 4 | concurrency | P4-T03 |
| P4-T03 | 4 | degradation/recovery | P4-T04 |
| P4-T04 | 4 | memory bound | P5-T01 |
| P5-T01 | 5 | authz/isolation | P5-T02 |
| P5-T02 | 5 | injection/fuzz | P5-T03 |
| P5-T03 | 5 | rate limit | P5-T04 |
| P5-T04 | 5 | PII/compliance | P5-T05 |
| P5-T05 | 5 | webhook/cookie | P6-T01 |
| P6-T01 | 6 | build smoke | P6-T02 |
| P6-T02 | 6 | health/monitor smoke | P6-T03 |
| P6-T03 | 6 | rollback trigger smoke | P7-T01 |
| P7-T01 | 7 | synthetic health monitor | P7-T02 |
| P7-T02 | 7 | journey probe | P7-T03 |
| P7-T03 | 7 | auto-rollback check | GS-TEARDOWN → END |

**Unbroken rule**: every card's `NEXT TEST ID` matches the row below it.
**No manual gates**: phases auto-run in orchestrator order 1→7.
