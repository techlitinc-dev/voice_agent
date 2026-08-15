# 07 — Billing & Wallet Tests

> Test cases for wallet balance, top-ups (Razorpay/Stripe test mode), call
> debits, plans, number rentals, GST invoices, and auto top-up. Never test
> against real payment keys — Razorpay/Stripe must be in **test mode**.

---

## A. Wallet

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| BILL-01 | Wallet balance loads | 1. Go to `/billing`. | Balance matches `Wallet` in DB; INR formatted (₹). | ☐ |
| BILL-02 | Trial credit granted | 1. Register a new workspace. 2. Check wallet. | ₹1,000 trial credit recorded as `WalletTransaction` (TRIAL_CREDIT). | ☐ |
| BILL-03 | Call debit applied | 1. Make a test call. 2. Check `/billing` + wallet transactions. | `CALL_DEBIT` transaction created; balance reduced by `billedPaise`. | ☐ |
| BILL-04 | Debit idempotency | 1. Make a call, then re-trigger the post-call webhook. | No double debit; `Call.billedPaise` unchanged. | ☐ |
| BILL-05 | Low balance alert | 1. Spend wallet below threshold (e.g., ₹100). | Alert shown on dashboard/billing; notification sent. | ☐ |
| BILL-06 | Insufficient balance handling | 1. Set balance to ₹0, make a call. | Call blocked or routed to fallback (no negative wallet); clear error. | ☐ |

## B. Top-up & Payments

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| BILL-07 | Razorpay top-up (test) | 1. `/billing` → Top up ₹500. 2. Use Razorpay test card (e.g., `4111 1111 1111 1111`). | `PaymentOrder` created; webhook capture credits wallet ₹500. | ☐ |
| BILL-08 | Stripe top-up (test) | 1. Top up ₹500 via Stripe test mode. | Wallet credited after webhook; transaction recorded. | ☐ |
| BILL-09 | Failed payment | 1. Use a declined test card. | No credit; order marked failed; user sees error. | ☐ |
| BILL-10 | Payment idempotency | 1. Deliver the payment webhook twice. | Wallet credited once only. | ☐ |
| BILL-11 | Refund | 1. Trigger a refund for a transaction (support action). | `REFUND` transaction; balance restored; invoice adjusted. | ☐ |

## C. Plans & Add-ons

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| BILL-12 | Plan upgrade | 1. `/billing/plans` → upgrade Starter → Pro. | `Subscription` updated; feature gates open (e.g., voice cloning). | ☐ |
| BILL-13 | Plan downgrade | 1. Downgrade Pro → Starter. | Feature gates close; gated features blocked with upsell message. | ☐ |
| BILL-14 | Add-on purchase | 1. `/billing/addons` → buy a seat add-on. | `AddOnPurchase` recorded; seat count increases. | ☐ |
| BILL-15 | Plan fee debit | 1. Renewal cycle runs (or trigger). | `PLAN_FEE` transaction; invoice generated. | ☐ |
| BILL-16 | Add-on debit | 1. Use a paid add-on feature (e.g., voice clone). | `ADDON_DEBIT` transaction; ₹5,000/mo add-on reflected. | ☐ |

## D. Number Rentals

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| BILL-17 | Rent a number | 1. `/numbers` → rent a DID (test pool). | `NumberRental` created; monthly rent debited or scheduled. | ☐ |
| BILL-18 | Rental renewal debit | 1. Renewal cycle runs. | `NUMBER_RENT` transaction per number; invoice updated. | ☐ |
| BILL-19 | Release number | 1. Release a rented number. | Rental ended; number returns to pool; prorated charge. | ☐ |
| BILL-20 | KYC gating for 140/1600 | 1. Try to rent a Series 140 number without KYC. | Blocked with KYC prompt (`TrialState` KYC-gated). | ☐ |

## E. Invoices & GST

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| BILL-21 | Invoice generated after top-up | 1. Complete a ₹500 top-up. 2. Go to `/billing/invoices/[id]`. | GST invoice (CGST/SGST/IGST) generated with GSTIN if set. | ☐ |
| BILL-22 | Invoice PDF download | 1. Open invoice → Download PDF. | PDF streams from MinIO; correct amounts. | ☐ |
| BILL-23 | Financial-year numbering | 1. Create invoices across FY boundary (or inspect). | Invoice numbers follow FY sequence (e.g., `VA/2025-26/…`). | ☐ |
| BILL-24 | GST settings | 1. `/billing/settings` → add GSTIN. | GSTIN saved; subsequent invoices include it. | ☐ |
| BILL-25 | Invoice list | 1. `/billing` → Invoices tab. | All invoices listed with status (paid/pending) and amounts. | ☐ |

## F. Auto Top-Up

| ID | Test Case | Steps | Expected | P |
|---|---|---|---|---|
| BILL-26 | Enable auto top-up | 1. `/billing/settings` → enable auto top-up, threshold ₹200, amount ₹500. | `AutoTopUp` config saved. | ☐ |
| BILL-27 | Auto top-up triggers | 1. Spend balance below ₹200. | Top-up of ₹500 initiated automatically; wallet credited. | ☐ |
| BILL-28 | Auto top-up failure | 1. Disable test card / use expired card. 2. Let balance drop below threshold. | Alert raised; no silent failure; retry or user notification. | ☐ |

---

## Prerequisites

- Razorpay + Stripe in **test mode** with known test cards.
- A new workspace (for BILL-02 trial credit).
- KYC-unverified tenant for BILL-20.

## Notes

- For BILL-04/10, use `redis-cli` or logs to confirm webhook dedup; verify `WalletTransaction` has one row.
- For BILL-03, compare `Call.billedPaise` to the wallet debit amount in `psql`.
- Never run these tests with live payment keys — verify mode in Razorpay/Stripe dashboard.
- Cross-browser: run BILL-01 and BILL-07 on Chrome, Firefox, Safari.
