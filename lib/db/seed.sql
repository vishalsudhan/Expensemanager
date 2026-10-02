BEGIN;

INSERT INTO currencies (id, code, name, symbol, decimal_places, is_active)
VALUES
  ('c0de0000-0000-4000-a000-000000000001', 'INR', 'Indian Rupee', '₹', 2, true),
  ('c0de0000-0000-4000-a000-000000000002', 'QAR', 'Qatari Riyal', '﷼', 2, true),
  ('c0de0000-0000-4000-a000-000000000003', 'AED', 'UAE Dirham', 'د.إ', 2, true),
  ('c0de0000-0000-4000-a000-000000000004', 'USD', 'US Dollar', '$', 2, true),
  ('c0de0000-0000-4000-a000-000000000005', 'EUR', 'Euro', '€', 2, true),
  ('c0de0000-0000-4000-a000-000000000006', 'GBP', 'British Pound', '£', 2, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO projects (name, description, color, icon, default_currency_id)
VALUES (
  'Qatar Move',
  'Development example project for a planned move.',
  '#1F6B55',
  'Plane',
  'c0de0000-0000-4000-a000-000000000001'
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name, icon, color)
VALUES
  ('Food', 'Utensils', '#E6A46A'),
  ('Travel', 'Plane', '#7298A7'),
  ('Shopping', 'ShoppingBag', '#CE8296'),
  ('Rent', 'House', '#AF8E68'),
  ('Utilities', 'Lightbulb', '#6F9E90'),
  ('Entertainment', 'Clapperboard', '#8E7CAA'),
  ('Healthcare', 'HeartPulse', '#C67570'),
  ('Bills', 'ReceiptText', '#7083A0'),
  ('Transport', 'Bus', '#748E78'),
  ('Education', 'BookOpen', '#C1954F'),
  ('Subscriptions', 'Repeat', '#6B8BB1'),
  ('Personal Care', 'Sparkles', '#C47C8F'),
  ('Miscellaneous', 'Shapes', '#8B8F88')
ON CONFLICT (name) DO NOTHING;

INSERT INTO labels (name, color)
VALUES
  ('Personal', '#1F6B55'),
  ('Family', '#7298A7'),
  ('Business', '#8E7CAA'),
  ('Urgent', '#C67570'),
  ('Important', '#C1954F')
ON CONFLICT (name) DO NOTHING;

INSERT INTO expenses (
  id,
  amount,
  date,
  project_id,
  category_id,
  currency_id,
  description,
  payment_method
)
VALUES
  (
    'e1ef116a-2b51-4bf2-bb42-b91ce8505001',
    5000.00,
    '2026-10-01',
    (SELECT id FROM projects WHERE name = 'Qatar Move'),
    (SELECT id FROM categories WHERE name = 'Travel'),
    'c0de0000-0000-4000-a000-000000000001',
    'Flight ticket',
    'credit_card'
  ),
  (
    'e1ef116a-2b51-4bf2-bb42-b91ce8505002',
    850.00,
    '2026-09-30',
    NULL,
    (SELECT id FROM categories WHERE name = 'Food'),
    'c0de0000-0000-4000-a000-000000000001',
    'Dinner',
    'upi'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO expense_labels (expense_id, label_id)
VALUES
  (
    'e1ef116a-2b51-4bf2-bb42-b91ce8505001',
    (SELECT id FROM labels WHERE name = 'Personal')
  ),
  (
    'e1ef116a-2b51-4bf2-bb42-b91ce8505001',
    (SELECT id FROM labels WHERE name = 'Important')
  ),
  (
    'e1ef116a-2b51-4bf2-bb42-b91ce8505002',
    (SELECT id FROM labels WHERE name = 'Personal')
  )
ON CONFLICT DO NOTHING;

COMMIT;