import type { CrmConnection, CrmProvider as CrmProviderEnum } from "@prisma/client";

export type CrmLead = {
  name: string;
  phone: string; // E.164
  email?: string;
  note?: string;
  outcome?: string; // call outcome to log, e.g. "qualified"
};

export type CrmPushResult = { externalId: string; created: boolean };

export type CrmUpdate = {
  externalId: string;
  name?: string;
  phone?: string;
  email?: string;
  raw?: unknown;
};

export type CrmTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  instanceUrl?: string | null;
};

/** The provider contract. EVERY CRM adapter implements this. */
export interface CrmProvider {
  readonly provider: CrmProviderEnum;
  /** OAuth consent URL (state carries our signed payload). */
  getAuthUrl(state: string): string;
  /** Exchange the OAuth code for tokens. */
  exchangeCode(code: string): Promise<CrmTokens>;
  /** Refresh an expired access token; returns fresh tokens. */
  refreshTokens(conn: CrmConnection): Promise<CrmTokens>;
  /** Create or update (by phone) a contact/lead. */
  pushLead(conn: CrmConnection, lead: CrmLead): Promise<CrmPushResult>;
  /** Pull records modified since `since` (two-way sync worker). */
  pullUpdates(conn: CrmConnection, since: Date): Promise<CrmUpdate[]>;
  /** List writable fields for the field-mapping editor. */
  listFields(conn: CrmConnection): Promise<string[]>;
}
