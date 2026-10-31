-- 0007 · Manual payments (UPI / bank transfer + screenshot) and user documents
--
-- * A member can pay outside Razorpay (scan the admin's UPI QR / bank transfer),
--   then upload a payment screenshot + UTR. The purchase stays `pending` until an
--   admin verifies it (Payments → "Proof submitted"), which activates the package
--   through the same `activate_purchase` RPC as gateway payments.
-- * Members can upload their own UPI QR code (stored as payout_details.upiQrPath).
-- * Files live in the private `uploads` storage bucket. Only the API (service role)
--   reads/writes it; admins view files through short-lived signed URLs.

alter table purchases
  add column if not exists manual_proof_path   text,
  add column if not exists manual_utr          text,
  add column if not exists manual_note         text,
  add column if not exists manual_submitted_at timestamptz;

create index if not exists purchases_manual_review_idx
  on purchases(manual_submitted_at desc)
  where status = 'pending' and manual_proof_path is not null;

-- Where members send manual payments. Edited in Admin → Settings.
insert into app_settings(key, value) values
  ('manualPayment', '{"enabled": true, "upiId": "", "payeeName": "", "bankName": "", "accountName": "",
                      "accountNumber": "", "ifsc": "", "qrPath": "", "instructions": ""}')
on conflict (key) do nothing;

-- Private bucket (no public URLs). 5 MB images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uploads', 'uploads', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
