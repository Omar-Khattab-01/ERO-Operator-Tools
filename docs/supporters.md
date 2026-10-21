# Shared supporter recognition

ERO uses the same Supabase supporter tables and six Stripe Payment Links as OC.
The existing OC webhook at https://oc-bus-tracker.vercel.app/api/support/webhook
is the sole writer of verified payment and subscription state. Keep it enabled.
Do not create a second subscription or import the same historical payments again.

ERO requires SUPABASE_URL, SUPABASE_ANON_KEY, and the server-only
SUPABASE_SERVICE_ROLE_KEY in its production Vercel project. Never expose the
service-role key through the public config endpoint or commit it.
No Stripe secret or webhook signing secret is required in ERO.

Supabase Auth must allow this exact callback:
https://ero-operator-tools.vercel.app/support?restore=1
Keep OC's existing Site URL and redirect URLs unchanged.

Each origin has its own HttpOnly device cookie. Checkout passes its SHA-256 hash
to Stripe as client_reference_id; the OC webhook stores that hash in the shared
tables. Prior supporters and people moving between sites/devices verify their
checkout email once on ERO. They do not need to contribute twice.

Active monthly subscriptions receive monthly recognition. One-time payments
receive 30 days of recognition from payment, excluding refunded/disputed charges.
Closing a thank-you banner hides that type for 30 days without restoring support
asks. The support page can restore the banner early. Management and cancellation
use the existing Stripe email-login customer portal.

Run npm test for backend authorization, shared-record lookup, expiry, and banner
dismissal coverage. Run node tools/preview_supporters.js for loopback-only
sample banners at http://localhost:7864/preview/monthly and /preview/one-time.
These fixture routes do not exist in production and never grant real status.
