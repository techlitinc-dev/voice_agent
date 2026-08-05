/**
 * QA rubric registry (spec §8 AI QA / auto-scoring).
 *
 * Rubrics live in CODE in v1 — they are prompt-engineering artifacts, reviewed and
 * deployed like prompts. To add a workspace-specific rubric: add an entry here and
 * map it in `rubricForAgent`. Do NOT store rubrics in SavedReport/WebhookSubscription
 * or any other schema model.
 */

export type QaCriterion = {
  key: string;         // machine key stored in QaScore.scores JSON
  label: string;       // human label shown in the UI
  maxPoints: number;   // integer
  instruction: string; // what the scorer LLM must check
};

export type QaRubric = {
  name: string;        // stored in QaScore.rubricName
  description: string;
  criteria: QaCriterion[];
};

export const RUBRICS: Record<string, QaRubric> = {
  "receptionist-default": {
    name: "receptionist-default",
    description: "Inbound receptionist quality: greeting, compliance disclosure, FAQ accuracy, closing.",
    criteria: [
      {
        key: "greeting",
        label: "Greeting",
        maxPoints: 10,
        instruction:
          "Did the agent greet the caller warmly, state the business name, and identify itself as an AI assistant within the first turn? 10 = perfect, 0 = no greeting.",
      },
      {
        key: "compliance_lines",
        label: "Compliance lines",
        maxPoints: 10,
        instruction:
          "Were mandatory lines said correctly — call-recording disclosure, and no medical/legal/financial advice given? Deduct heavily for missing disclosure or risky advice.",
      },
      {
        key: "faq_accuracy",
        label: "FAQ accuracy",
        maxPoints: 10,
        instruction:
          "Were factual answers (timings, prices, address) consistent and grounded? Score 0 if the agent invented facts not present in the conversation context (hallucination).",
      },
      {
        key: "closing",
        label: "Closing",
        maxPoints: 10,
        instruction:
          "Did the agent summarize what was agreed and close politely (next steps, thank you)?",
      },
    ],
  },
  "telecaller-default": {
    name: "telecaller-default",
    description: "Outbound telecaller quality: opener, identity disclosure, objection handling, closing.",
    criteria: [
      {
        key: "opening_hook",
        label: "Opening hook",
        maxPoints: 10,
        instruction: "Did the agent deliver the configured opening hook in the first 15 seconds?",
      },
      {
        key: "compliance_lines",
        label: "Compliance lines",
        maxPoints: 10,
        instruction:
          "Identity disclosure (business + AI) stated? DND/opt-out requests honored immediately? Deduct heavily otherwise.",
      },
      {
        key: "objection_handling",
        label: "Objection handling",
        maxPoints: 10,
        instruction: "Were objections answered per the playbook without pressure tactics?",
      },
      {
        key: "closing",
        label: "Closing",
        maxPoints: 10,
        instruction: "Clear next step (booking/callback/none) confirmed before hangup?",
      },
    ],
  },
};

export function maxScore(rubric: QaRubric): number {
  return rubric.criteria.reduce((a, c) => a + c.maxPoints, 0);
}

/** Pick a rubric for a call: outbound → telecaller rubric, inbound → receptionist. */
export function rubricForCall(direction: string): QaRubric {
  return direction === "OUTBOUND" ? RUBRICS["telecaller-default"] : RUBRICS["receptionist-default"];
}
