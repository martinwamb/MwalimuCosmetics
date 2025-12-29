# Product model and classification

This project now uses structured tags instead of a single category dropdown. Tags are normalized in the database (`TagGroup`, `Tag`, `ProductTag`) and enforced in the API.

## Required product fields
- `name`, `sku`, `price`, `currency` (default `KES`), `stockQty`, `status` (`DRAFT`, `ACTIVE`, `INACTIVE`, `ARCHIVED` for compatibility)
- Optional: `brand`, `compareAtPrice`, `shortDescription` (<=160 chars), `description`, `imageUrl` (main image), `galleryImages[]`, `featured`

## Tag groups
- **Product Type** (`product_type`, single, required): hair_oil, hair_food, hair_treatment, hair_dye, lotion, cream, body_oil, cleanser, toner, serum, shower_gel, soap, scrub, deodorant_roll_on, deodorant_spray, lip_care, sunscreen.
- **Care Area** (`care_area`, multi, required): hair, scalp, face, body, underarm, hands_feet.
- **Benefits** (`benefit`, multi, editable): hair_growth, anti_dandruff, strengthening, repairing, moisturizing, shine_gloss, anti_breakage, brightening, even_tone, anti_acne, soothing, hydrating, firming, exfoliating, odour_control, anti_perspirant.
- **Suitable For** (`suitable_for`, multi, editable): dry_skin, oily_skin, combination_skin, sensitive_skin, normal_skin, natural_hair, relaxed_hair, colored_hair, damaged_hair, low_porosity, high_porosity.
- **Ingredients / Formula** (`ingredient`, multi, editable): shea_butter, coconut_oil, castor_oil, olive_oil, aloe_vera, vitamin_e, tea_tree, glycolic_acid, salicylic_acid, niacinamide, fragrance_free, alcohol_free, sulfate_free, paraben_free.
- **Marketing Tags** (`marketing`, multi): new_arrival, best_seller, featured, seasonal, limited_offer.
- **Price buckets** are computed (not tagged): under_500, under_1000, under_2000, premium (>=2000).

## Auto-categories (not stored on products)
- Hair Care: `care_area` includes hair or scalp.
- Skin Care: `care_area` includes face.
- Bath & Body: `product_type` in shower_gel/soap/scrub/lotion/cream/body_oil or `care_area` includes body.
- Personal Care: `care_area` includes underarm or `product_type` starts with deodorant_.

## Homepage sections (rules)
- New Arrivals: marketing tag `new_arrival`.
- Big Savings: `compareAtPrice` exists and > `price` (on sale).
- Best Sellers: marketing tag `best_seller`.
- Featured Collection: marketing tag `featured`.
- Shop by Price: computed price buckets.
Each module supports a title, rule (group + value), max items, and sort order (`NEWEST`, `PRICE_ASC`, `PRICE_DESC`, `BEST_SELLING` fallback).

## API helpers
- `getProductsByRule(rule)` (apps/back/src/lib/taxonomy.ts) filters by marketing tag, care area, product type, benefit, price bucket, or `SPECIAL: ON_SALE`.
- `formatProduct` now returns `categories`, `priceBuckets`, `productType`, `careAreas`, `benefits`, `ingredients`, `marketingTags`, `onSale`, and legacy `category` (primary auto-category).

## Sample tagging
- **Shea Butter Hair Food**: product_type hair_food; care_area hair, scalp; benefits moisturizing, repairing, anti_breakage; suitable_for natural_hair, damaged_hair; ingredients shea_butter, vitamin_e; marketing_tags best_seller. Expected: Hair Care category, Shop by Need (damage/moisture), Best Sellers module.
- **Gentle Face Cleanser**: product_type cleanser; care_area face; benefits soothing, hydrating; suitable_for sensitive_skin; marketing_tags new_arrival. Expected: Skin Care category, New Arrivals module.
