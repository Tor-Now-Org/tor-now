# Context Map

## Contexts

- [Scheduling](./CONTEXT.md) — businesses publish availability; customers find a
  business and book time against it
- [Billing](./docs/billing/CONTEXT.md) — what each Business owes the platform, and
  whether they have paid

## Relationships

- **Billing → Scheduling**: two channels, and only two.
  - *Deactivation* — Billing deactivates a Business whose subscription has lapsed
    beyond its grace period.
  - *Entitlement* — Billing states which Features and what Resource Allowance a
    Business has. Billing knows Features by name only; Scheduling decides what
    each one means and enforces it. Billing still has no knowledge of
    Appointments or Services, and knows Resources only as a number.
- **Shared**: `BusinessId` only.
