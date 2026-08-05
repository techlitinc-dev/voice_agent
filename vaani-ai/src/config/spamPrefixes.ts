/**
 * Known spam/robocall caller-id prefixes (E.164 prefix match). Empty by default —
 * add prefixes as the operator identifies spam sources, e.g. "+91140" for the TRAI
 * promotional series if the business does not expect legitimate 140-series calls.
 */
export const SPAM_PREFIXES: string[] = [];
