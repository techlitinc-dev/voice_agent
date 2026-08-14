"use client";
import { useState } from "react";
import { WEBHOOK_EVENTS } from "@/lib/webhook-events";

/** Group labels for the visual event builder (docs/new-features/05 §3.9). */
const EVENT_GROUPS: { label: string; events: string[] }[] = [
  { label: "Calls", events: ["call.started", "call.completed", "call.missed"] },
  { label: "Leads & CRM", events: ["lead.qualified"] },
  { label: "Campaigns", events: ["campaign.finished"] },
  { label: "Compliance", events: ["contact.opted-out"] },
  { label: "Messaging", events: ["voicemail.received"] },
  { label: "Transfers", events: ["transfer.requested"] },
  { label: "Billing", events: ["wallet.low_balance"] },
];

/**
 * Visual event builder: a grouped checklist rendered inside the existing
 * `name="events"` form field contract (flat checkboxes read via
 * formData.getAll("events") — identical to the plain list it replaces, so the
 * server action and e2e/webhooks.spec.ts keep working unchanged).
 */
export function EventBuilder({ initial = [] as string[] }) {
  const [selected, setSelected] = useState<string[]>(initial);

  function toggle(event: string) {
    setSelected((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));
  }

  function toggleGroup(groupEvents: string[]) {
    const allSelected = groupEvents.every((e) => selected.includes(e));
    setSelected((prev) =>
      allSelected ? prev.filter((e) => !groupEvents.includes(e)) : [...new Set([...prev, ...groupEvents])]
    );
  }

  return (
    <div className="space-y-3" data-testid="event-builder">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">
          {selected.length} of {WEBHOOK_EVENTS.length} events selected
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSelected([...WEBHOOK_EVENTS])}
            data-testid="event-select-all"
            className="rounded-md border border-border px-2 py-1 text-xs hover:border-primary/50"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setSelected([])}
            data-testid="event-clear-all"
            className="rounded-md border border-border px-2 py-1 text-xs hover:border-primary/50"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {EVENT_GROUPS.map((group) => {
          const groupSelected = group.events.filter((e) => selected.includes(e)).length;
          return (
            <div key={group.label} className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium">{group.label}</span>
                <button
                  type="button"
                  onClick={() => toggleGroup(group.events)}
                  data-testid={`event-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`}
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  {groupSelected === group.events.length ? "Clear group" : `Select ${group.events.length}`}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.events.map((event) => (
                  <label key={event} className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      name="events"
                      value={event}
                      checked={selected.includes(event)}
                      onChange={() => toggle(event)}
                      data-testid={`event-checkbox-${event}`}
                    />
                    <span className="font-mono">{event}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
