-- Group C (ParentPortal.tsx / Invoices.tsx / Wallet.tsx / Transactions.tsx) read-side
-- migration: additive field the Firestore code reads but 0001_schema.sql omitted.

-- ParentPortal.tsx renders a child's grade next to their name
-- (`sSnap.data().grade` in the old Firestore code). `students` carries no
-- academic-year/grade field in the redesigned schema; add it as a plain
-- nullable text column, display-only, no billing implications.
alter table students add column if not exists grade text;
