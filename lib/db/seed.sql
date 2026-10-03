-- Reference data for Pocketful. Idempotent: every insert is guarded by a
-- conflict clause, so re-running never creates duplicates and never renames or
-- deletes an existing record.

BEGIN;

-- --- retire the legacy flat categories (before inserting the new hierarchy) --
-- Nothing is deleted: ids stay, so any expense still pointing at one keeps
-- working. Legacy rows are archived and hidden from the active list.
--
-- A handful of legacy names are identical to names in the new hierarchy
-- (Shopping, Rent, Entertainment, Travel, Subscriptions, Miscellaneous). Those
-- rows get a " (legacy)" marker and a "-legacy" slug so the exact hierarchy
-- names stay available. This is the only change made to legacy rows beyond
-- archiving, and it is reversible.
UPDATE "categories"
SET "status" = 'archived'
WHERE "status" = 'active'
  AND "id" NOT IN (
    SELECT "id" FROM "categories" WHERE "id"::text LIKE '20000000-%' OR "id"::text LIKE '30000000-%'
  );
--> statement-breakpoint

UPDATE "categories"
SET
  "name" = "name" || ' (legacy)',
  "slug" = "slug" || '-legacy'
WHERE "status" = 'archived'
  AND "id" NOT IN (
    SELECT "id" FROM "categories" WHERE "id"::text LIKE '20000000-%' OR "id"::text LIKE '30000000-%'
  )
  AND "name" = ANY (ARRAY[
    'Food & Dining', 'Entertainment & Social', 'Housing & Utilities', 'Transportation',
    'Finance', 'Shopping', 'Health & Personal', 'House Construction',
    'Travel & Relocation', 'Subscriptions', 'Other',
    'Groceries', 'Dining Out', 'Food Delivery', 'Coffee & Snacks',
    'Entertainment', 'Movies & Events', 'Hangout / Social',
    'Rent', 'Electricity', 'Water', 'Internet', 'Phone', 'Maintenance',
    'Fuel', 'Taxi / Ride-hailing', 'Public Transport', 'Vehicle Maintenance', 'Parking',
    'Loan EMI', 'Credit Card Payment', 'Bank Charges', 'Interest', 'Other Financial',
    'Clothing', 'Electronics', 'Household', 'Personal Shopping',
    'Medical', 'Pharmacy', 'Grooming', 'Fitness', 'Personal Care',
    'Materials', 'Labour', 'Electrical', 'Plumbing', 'Interior', 'Furniture',
    'Architect / Design', 'Other Construction',
    'Flights', 'Accommodation', 'Visa', 'Travel', 'Relocation',
    'Streaming', 'Software', 'Apps', 'Other Subscriptions', 'Miscellaneous'
  ]);

-- --- currencies -------------------------------------------------------------
INSERT INTO currencies (id, code, name, symbol, decimal_places, is_active)
VALUES
  ('c0de0000-0000-4000-a000-000000000001', 'INR', 'Indian Rupee', '₹', 2, true),
  ('c0de0000-0000-4000-a000-000000000002', 'QAR', 'Qatari Riyal', '﷼', 2, true),
  ('c0de0000-0000-4000-a000-000000000003', 'AED', 'UAE Dirham', 'د.إ', 2, true),
  ('c0de0000-0000-4000-a000-000000000004', 'USD', 'US Dollar', '$', 2, true),
  ('c0de0000-0000-4000-a000-000000000005', 'EUR', 'Euro', '€', 2, true),
  ('c0de0000-0000-4000-a000-000000000006', 'GBP', 'British Pound', '£', 2, true)
ON CONFLICT (code) DO NOTHING;

-- --- locations --------------------------------------------------------------
-- A location records only where spend happened. It never implies a currency.
INSERT INTO locations (id, name, slug, country_code, status)
VALUES
  ('10000000-0000-4000-a000-000000000001', 'India', 'india', 'IN', 'active'),
  ('10000000-0000-4000-a000-000000000002', 'Qatar', 'qatar', 'QA', 'active')
ON CONFLICT (slug) DO NOTHING;

-- --- projects (purpose / context, never geography) --------------------------
INSERT INTO projects (id, name, description, color, icon, status, default_currency_id)
VALUES
  ('40000000-0000-4000-a000-000000000001', 'Personal', 'Everyday personal spending.', '#47796A', 'Sparkles', 'active', 'c0de0000-0000-4000-a000-000000000001'),
  ('40000000-0000-4000-a000-000000000003', 'Qatar Relocation', 'Costs of moving to and settling in Qatar.', '#7298A7', 'Plane', 'active', 'c0de0000-0000-4000-a000-000000000002'),
  ('40000000-0000-4000-a000-000000000004', 'WebCastle', 'WebCastle product and business work.', '#8E7CAA', 'Briefcase', 'active', 'c0de0000-0000-4000-a000-000000000001'),
  ('40000000-0000-4000-a000-000000000005', 'Dubai Trip', 'Trips to and around the UAE.', '#B9795E', 'Sparkles', 'active', 'c0de0000-0000-4000-a000-000000000002')
ON CONFLICT (name) DO NOTHING;

-- --- labels (global, cross-cutting, many-to-many) ---------------------------
INSERT INTO labels (name, color)
VALUES
  ('Personal', '#1F6B55'),
  ('Family', '#7298A7'),
  ('Business', '#8E7CAA'),
  ('Important', '#C1954F'),
  ('Urgent', '#C67570'),
  ('Reimbursable', '#9C8050')
ON CONFLICT (name) DO NOTHING;

-- --- hierarchical categories ------------------------------------------------
-- Top-level categories carry the icon/colour; subcategories repeat them so the
-- UI can group visually without a second palette. Ids are stable: 20000000-...
-- for parents, 30000000-... for children. An expense stores the child id in
-- category_id; the parent is reached through parent_id.

INSERT INTO categories (id, name, slug, parent_id, icon, color, status) VALUES
('20000000-0000-4000-a000-000000000001', 'Food & Dining', 'food-and-dining', NULL, 'Utensils', '#E6A46A', 'active'),
('20000000-0000-4000-a000-000000000002', 'Entertainment & Social', 'entertainment-and-social', NULL, 'Clapperboard', '#8E7CAA', 'active'),
('20000000-0000-4000-a000-000000000003', 'Housing & Utilities', 'housing-and-utilities', NULL, 'House', '#AF8E68', 'active'),
('20000000-0000-4000-a000-000000000004', 'Transportation', 'transportation', NULL, 'Bus', '#748E78', 'active'),
('20000000-0000-4000-a000-000000000005', 'Finance', 'finance', NULL, 'Wallet', '#66869A', 'active'),
('20000000-0000-4000-a000-000000000006', 'Shopping', 'shopping', NULL, 'ShoppingBag', '#CE8296', 'active'),
('20000000-0000-4000-a000-000000000007', 'Health & Personal', 'health-and-personal', NULL, 'HeartPulse', '#C67570', 'active'),
('20000000-0000-4000-a000-000000000008', 'House Construction', 'house-construction-category', NULL, 'Hammer', '#9C8050', 'active'),
('20000000-0000-4000-a000-000000000009', 'Travel & Relocation', 'travel-and-relocation', NULL, 'Plane', '#7298A7', 'active'),
('20000000-0000-4000-a000-000000000010', 'Subscriptions', 'subscriptions', NULL, 'Repeat', '#6B8BB1', 'active'),
('20000000-0000-4000-a000-000000000011', 'Other', 'other', NULL, 'Shapes', '#8B8F88', 'active')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO categories (id, name, slug, parent_id, icon, color, status) VALUES
-- Food & Dining
('30000000-0000-4000-a000-000000000001', 'Groceries', 'groceries', '20000000-0000-4000-a000-000000000001', 'Utensils', '#E6A46A', 'active'),
('30000000-0000-4000-a000-000000000002', 'Dining Out', 'dining-out', '20000000-0000-4000-a000-000000000001', 'Utensils', '#E6A46A', 'active'),
('30000000-0000-4000-a000-000000000003', 'Food Delivery', 'food-delivery', '20000000-0000-4000-a000-000000000001', 'Utensils', '#E6A46A', 'active'),
('30000000-0000-4000-a000-000000000004', 'Coffee & Snacks', 'coffee-and-snacks', '20000000-0000-4000-a000-000000000001', 'Utensils', '#E6A46A', 'active'),
-- Entertainment & Social
('30000000-0000-4000-a000-000000000005', 'Entertainment', 'entertainment', '20000000-0000-4000-a000-000000000002', 'Clapperboard', '#8E7CAA', 'active'),
('30000000-0000-4000-a000-000000000006', 'Movies & Events', 'movies-and-events', '20000000-0000-4000-a000-000000000002', 'Clapperboard', '#8E7CAA', 'active'),
('30000000-0000-4000-a000-000000000007', 'Hangout / Social', 'hangout-social', '20000000-0000-4000-a000-000000000002', 'Clapperboard', '#8E7CAA', 'active'),
-- Housing & Utilities
('30000000-0000-4000-a000-000000000008', 'Rent', 'rent', '20000000-0000-4000-a000-000000000003', 'House', '#AF8E68', 'active'),
('30000000-0000-4000-a000-000000000009', 'Electricity', 'electricity', '20000000-0000-4000-a000-000000000003', 'House', '#AF8E68', 'active'),
('30000000-0000-4000-a000-000000000010', 'Water', 'water', '20000000-0000-4000-a000-000000000003', 'House', '#AF8E68', 'active'),
('30000000-0000-4000-a000-000000000011', 'Internet', 'internet', '20000000-0000-4000-a000-000000000003', 'House', '#AF8E68', 'active'),
('30000000-0000-4000-a000-000000000012', 'Phone', 'phone', '20000000-0000-4000-a000-000000000003', 'House', '#AF8E68', 'active'),
('30000000-0000-4000-a000-000000000013', 'Maintenance', 'maintenance', '20000000-0000-4000-a000-000000000003', 'House', '#AF8E68', 'active'),
-- Transportation
('30000000-0000-4000-a000-000000000014', 'Fuel', 'fuel', '20000000-0000-4000-a000-000000000004', 'Bus', '#748E78', 'active'),
('30000000-0000-4000-a000-000000000015', 'Taxi / Ride-hailing', 'taxi-ride-hailing', '20000000-0000-4000-a000-000000000004', 'Bus', '#748E78', 'active'),
('30000000-0000-4000-a000-000000000016', 'Public Transport', 'public-transport', '20000000-0000-4000-a000-000000000004', 'Bus', '#748E78', 'active'),
('30000000-0000-4000-a000-000000000017', 'Vehicle Maintenance', 'vehicle-maintenance', '20000000-0000-4000-a000-000000000004', 'Bus', '#748E78', 'active'),
('30000000-0000-4000-a000-000000000018', 'Parking', 'parking', '20000000-0000-4000-a000-000000000004', 'Bus', '#748E78', 'active'),
-- Finance
('30000000-0000-4000-a000-000000000019', 'Loan EMI', 'loan-emi', '20000000-0000-4000-a000-000000000005', 'Wallet', '#66869A', 'active'),
('30000000-0000-4000-a000-000000000020', 'Credit Card Payment', 'credit-card-payment', '20000000-0000-4000-a000-000000000005', 'Wallet', '#66869A', 'active'),
('30000000-0000-4000-a000-000000000021', 'Bank Charges', 'bank-charges', '20000000-0000-4000-a000-000000000005', 'Wallet', '#66869A', 'active'),
('30000000-0000-4000-a000-000000000022', 'Interest', 'interest', '20000000-0000-4000-a000-000000000005', 'Wallet', '#66869A', 'active'),
('30000000-0000-4000-a000-000000000023', 'Other Financial', 'other-financial', '20000000-0000-4000-a000-000000000005', 'Wallet', '#66869A', 'active'),
-- Shopping
('30000000-0000-4000-a000-000000000024', 'Clothing', 'clothing', '20000000-0000-4000-a000-000000000006', 'ShoppingBag', '#CE8296', 'active'),
('30000000-0000-4000-a000-000000000025', 'Electronics', 'electronics', '20000000-0000-4000-a000-000000000006', 'ShoppingBag', '#CE8296', 'active'),
('30000000-0000-4000-a000-000000000026', 'Household', 'household', '20000000-0000-4000-a000-000000000006', 'ShoppingBag', '#CE8296', 'active'),
('30000000-0000-4000-a000-000000000027', 'Personal Shopping', 'personal-shopping', '20000000-0000-4000-a000-000000000006', 'ShoppingBag', '#CE8296', 'active'),
-- Health & Personal
('30000000-0000-4000-a000-000000000028', 'Medical', 'medical', '20000000-0000-4000-a000-000000000007', 'HeartPulse', '#C67570', 'active'),
('30000000-0000-4000-a000-000000000029', 'Pharmacy', 'pharmacy', '20000000-0000-4000-a000-000000000007', 'HeartPulse', '#C67570', 'active'),
('30000000-0000-4000-a000-000000000030', 'Grooming', 'grooming', '20000000-0000-4000-a000-000000000007', 'HeartPulse', '#C67570', 'active'),
('30000000-0000-4000-a000-000000000031', 'Fitness', 'fitness', '20000000-0000-4000-a000-000000000007', 'HeartPulse', '#C67570', 'active'),
('30000000-0000-4000-a000-000000000032', 'Personal Care', 'personal-care', '20000000-0000-4000-a000-000000000007', 'HeartPulse', '#C67570', 'active'),
-- House Construction
('30000000-0000-4000-a000-000000000033', 'Materials', 'materials', '20000000-0000-4000-a000-000000000008', 'Hammer', '#9C8050', 'active'),
('30000000-0000-4000-a000-000000000034', 'Labour', 'labour', '20000000-0000-4000-a000-000000000008', 'Hammer', '#9C8050', 'active'),
('30000000-0000-4000-a000-000000000035', 'Electrical', 'electrical', '20000000-0000-4000-a000-000000000008', 'Hammer', '#9C8050', 'active'),
('30000000-0000-4000-a000-000000000036', 'Plumbing', 'plumbing', '20000000-0000-4000-a000-000000000008', 'Hammer', '#9C8050', 'active'),
('30000000-0000-4000-a000-000000000037', 'Interior', 'interior', '20000000-0000-4000-a000-000000000008', 'Hammer', '#9C8050', 'active'),
('30000000-0000-4000-a000-000000000038', 'Furniture', 'furniture', '20000000-0000-4000-a000-000000000008', 'Hammer', '#9C8050', 'active'),
('30000000-0000-4000-a000-000000000039', 'Architect / Design', 'architect-design', '20000000-0000-4000-a000-000000000008', 'Hammer', '#9C8050', 'active'),
('30000000-0000-4000-a000-000000000040', 'Other Construction', 'other-construction', '20000000-0000-4000-a000-000000000008', 'Hammer', '#9C8050', 'active'),
-- Travel & Relocation
('30000000-0000-4000-a000-000000000041', 'Flights', 'flights', '20000000-0000-4000-a000-000000000009', 'Plane', '#7298A7', 'active'),
('30000000-0000-4000-a000-000000000042', 'Accommodation', 'accommodation', '20000000-0000-4000-a000-000000000009', 'Plane', '#7298A7', 'active'),
('30000000-0000-4000-a000-000000000043', 'Visa', 'visa', '20000000-0000-4000-a000-000000000009', 'Plane', '#7298A7', 'active'),
('30000000-0000-4000-a000-000000000044', 'Travel', 'travel', '20000000-0000-4000-a000-000000000009', 'Plane', '#7298A7', 'active'),
('30000000-0000-4000-a000-000000000045', 'Relocation', 'relocation', '20000000-0000-4000-a000-000000000009', 'Plane', '#7298A7', 'active'),
-- Subscriptions
('30000000-0000-4000-a000-000000000046', 'Streaming', 'streaming', '20000000-0000-4000-a000-000000000010', 'Repeat', '#6B8BB1', 'active'),
('30000000-0000-4000-a000-000000000047', 'Software', 'software', '20000000-0000-4000-a000-000000000010', 'Repeat', '#6B8BB1', 'active'),
('30000000-0000-4000-a000-000000000048', 'Apps', 'apps', '20000000-0000-4000-a000-000000000010', 'Repeat', '#6B8BB1', 'active'),
('30000000-0000-4000-a000-000000000049', 'Other Subscriptions', 'other-subscriptions', '20000000-0000-4000-a000-000000000010', 'Repeat', '#6B8BB1', 'active'),
-- Other
('30000000-0000-4000-a000-000000000050', 'Miscellaneous', 'miscellaneous', '20000000-0000-4000-a000-000000000011', 'Shapes', '#8B8F88', 'active')
ON CONFLICT (slug) DO NOTHING;

COMMIT;