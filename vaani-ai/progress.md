# Progress — Phase 10: UI Polish, Onboarding Wizard, In-App Guidance, KYC Flow, White-Label & Landing Page

Executing `/root/voice_agent/CRM-AI-V2/plan/10_ui_polish_and_landing_page.md` exactly (project root: `/root/voice_agent/vaani-ai`).

## Status

| Step | Description | Status | Evidence |
|---|---|---|---|
| 0 | Env additions + contract sanity check | ✅ done | 3 vars in .env, 1 in .env.example; all 7 contract files + checkFeatureGate/kycGateError present |
| 1 | Landing page (extended) | ✅ done | typecheck 0, build exit 0 |
| 2 | Loading/error/404 states | ✅ done | typecheck 0 |
| 3 | Settings page | ✅ done | typecheck 0, build exit 0, /settings route |
| 4 | Pure logic libs (onboarding/sample-data/branding/domain-verify) | ✅ done | typecheck 0 |
| 5 | Unit tests ×4 | ✅ done | 4 files passed, 35 tests |
| 6 | Onboarding server actions | ✅ done | typecheck 0 |
| 7 | Onboarding wizard `/onboarding` | ✅ done | typecheck 0, build exit 0, route present |
| 8 | Tooltip + resume + checklist widget | ✅ done | typecheck 0 |
| 9 | App layout rewrite + nav-link + middleware patch | ✅ done | build exit 0; grep shows api/domain-ask line |
| 10 | KYC flow (`/settings/kyc`) | ✅ done | typecheck 0, build exit 0, route present |
| 11 | Branding actions + logo route + domain-ask route | ✅ done | typecheck 0, build exit 0, both API routes present |
| 12 | Branding page UI (`/settings/branding`) | ✅ done | typecheck 0, build exit 0, route present |
| 13 | Page titles ×10 | ✅ done | typecheck 0, build exit 0 |
| 14 | Responsive smoke pass | ✅ OPERATOR | manual mobile browser check required (desktop-first app, sidebar fixed in v1) |
| 15 | Integration tests (curl) | ✅ done | T1=403 T2=400/400 T3=307 T4=VERIFIED/3\|t T5=35 passed; landing/login 200 |
| 16 | Git checkpoint | pending | commit after this file |

## Notes / Deviations

- Project root is `/root/voice_agent/vaani-ai` (guide's `/root/vaani-ai` path maps here).
- Dev/build run with `unset NODE_ENV NODE_OPTIONS` (environment exports NODE_ENV=production which breaks Next middleware).
- Guide Step 9 layout omits the guide-09 `/reseller` nav item that the previous layout had; the new layout keeps the guide-10 NAV exactly (14 items + Setup). Reseller remains reachable via its route; noted per "minimal deviation" rule.
- Guide Step 15's `(npm run dev ... &) ; sleep 8` start pattern used; server stopped via `pkill -f "next dev"`.
- T4 seeded values confirmed: TrialState `VERIFIED`, OnboardingState `currentStep=3, sampleDataEnabled=t` (guide-02 seed).
- Sample-data seed/clear actions NOT executed live (require a workspace session + Dograh); unit tests cover the builders/where-fragments.
- `mc` not initialised in vaani-minio container; KYC MinIO object verification deferred to operator manual pass (DB `has_file` check is the fallback the guide allows).
