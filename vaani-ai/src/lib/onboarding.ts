/**
 * Onboarding wizard state machine (readme §13). Pure — unit-tested.
 * Checklist JSON shape stored in OnboardingState.checklist:
 *   { industry, template, knowledge, test_call, number, dismissed? }
 * currentStep is an index into WIZARD_STEPS (0..5). Step 5 = "go live".
 */

export const WIZARD_STEPS = [
  { index: 0, key: "industry", title: "Pick your industry" },
  { index: 1, key: "template", title: "Pick a template agent" },
  { index: 2, key: "knowledge", title: "Connect knowledge base" },
  { index: 3, key: "test_call", title: "Test call in browser" },
  { index: 4, key: "number", title: "Get a number" },
  { index: 5, key: "live", title: "Go live" },
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"];

export type OnboardingChecklist = {
  industry?: boolean;
  template?: boolean;
  knowledge?: boolean;
  test_call?: boolean;
  number?: boolean;
  dismissed?: boolean;
};

/** The five checklist items that drive the progress bar ("live" is the finish line). */
export const CHECKLIST_KEYS: Exclude<WizardStepKey, "live">[] = [
  "industry",
  "template",
  "knowledge",
  "test_call",
  "number",
];

export function parseChecklist(raw: unknown): OnboardingChecklist {
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as OnboardingChecklist;
  }
  return {};
}

/** Merge a patch into the existing checklist (never drops unrelated keys). */
export function mergeChecklist(
  existing: OnboardingChecklist,
  patch: Partial<OnboardingChecklist>,
): OnboardingChecklist {
  return { ...existing, ...patch };
}

/** First incomplete step index (0..4). Returns 5 ("go live") when all five are done. */
export function nextStep(checklist: OnboardingChecklist): number {
  for (let i = 0; i < CHECKLIST_KEYS.length; i++) {
    if (!checklist[CHECKLIST_KEYS[i]]) return i;
  }
  return 5;
}

/** Progress toward go-live, 0..100. */
export function progressPercent(checklist: OnboardingChecklist): number {
  const done = CHECKLIST_KEYS.filter((k) => checklist[k]).length;
  return Math.round((done / CHECKLIST_KEYS.length) * 100);
}

/**
 * Minimum needed to finish the wizard ("go live"): industry + template picked.
 * Knowledge/test-call/number are strongly recommended but skippable — the
 * dashboard checklist keeps nudging after the wizard closes.
 */
export function canGoLive(checklist: OnboardingChecklist): boolean {
  return Boolean(checklist.industry && checklist.template);
}

export function isOnboardingComplete(state: {
  completedAt: Date | null;
} | null): boolean {
  return state?.completedAt != null;
}
