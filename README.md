## Mwalimu Cosmetics Platform

Milestone-oriented scaffold for ecommerce + POS + AI + ops tooling.

### Structure
- `apps/front` - Next.js storefront/admin/POS shells.
- `apps/back` - Express API with placeholder routes for products, orders, banking, AI.
- `apps/pos` - ESC/POS printing stub for TEP-300 SUE thermal printer.
- `apps/worker` - AI/ops worker skeleton for price gaps, slow movers, seasonality.
- `packages/db` - Prisma schema for core domain models (users, products, sales, banking, AI recs, clocking).

### Running (dev, after installing deps)
1) Install: `npm install` (uses workspaces).  
2) API: `npm run dev:back`  
3) Web: `npm run dev:front` then open http://localhost:3000  
4) Worker (dry run): `npm run dev:worker`  
5) POS demo print (ensure vendor/product IDs set): `npm run dev:pos`

### Milestone Progress
- M1: Auth/RBAC to be wired; Prisma schema ready. API routes stubbed.  
- M2: Storefront shell with catalog cards; mock data; checkout/payment integration pending.  
- M3: POS UI stub + thermal printer stub.  
- M4: Purchases/inventory data models defined; API UI pending.  
- M5: Bank models and reconciliation endpoints stubbed.  
- M6: AI worker scaffolds price gap, slow mover, seasonal alerts; API intake ready.  
- M7: Admin dashboard shell; attendance model present; WebAuthn/biometric capture pending.

### Next Steps
1) Provision Postgres; set `packages/db/.env` with `DATABASE_URL`; run `npm run prisma:migrate --workspace @mwalimu/db`.  
2) Add auth (NextAuth/Clerk) + role guards in web/API.  
3) Replace mock data with Prisma calls and transaction-safe inventory movements.  
4) Integrate Stripe/Paystack/Flutterwave for online checkout; connect POS to the API.  
5) Implement CSV bank import + reconciliation UI.  
6) Swap worker heuristics with real data + OpenAI/forecasting models; persist to `ai_recommendations`.  
7) Wire WebAuthn or device SDK for clock-in/out and export timesheets.
