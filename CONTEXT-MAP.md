# Context Map

## Contexts

- [Scheduling](./CONTEXT.md) — businesses publish availability; customers find a
  business and book time against it
- [Billing](./docs/billing/CONTEXT.md) — what each Business owes the platform, and
  whether they have paid

## Relationships

- **Billing → Scheduling**: Billing deactivates a Business whose subscription has
  lapsed beyond its grace period. Deactivation is the only channel between the two
  contexts; Billing has no knowledge of Appointments, Services or Resources.
- **Shared**: `BusinessId` only.
