BEGIN;

INSERT INTO projects (name, description, color, icon)
VALUES (
  'Qatar Move',
  'Development example project for a planned move.',
  '#1F6B55',
  'Plane'
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
    'Flight ticket',
    'credit_card'
  ),
  (
    'e1ef116a-2b51-4bf2-bb42-b91ce8505002',
    850.00,
    '2026-09-30',
    NULL,
    (SELECT id FROM categories WHERE name = 'Food'),
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