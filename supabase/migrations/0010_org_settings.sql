-- OrganizationSettings.tsx / BillingInvoiceSettings.tsx read/write a nested
-- config blob (dashboard/students/calendar/documents/messaging/billing) that
-- was never relationally modeled in Firestore either — kept as jsonb here
-- too, same posture as payment_gateways.tax and invoices.items.
alter table organizations add column if not exists settings jsonb not null default '{}'::jsonb;
