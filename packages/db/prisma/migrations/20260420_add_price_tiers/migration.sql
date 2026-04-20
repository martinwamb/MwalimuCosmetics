-- Add wholesale and special price tiers to Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "wholesalePrice" DECIMAL(12,2);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "specialPrice" DECIMAL(12,2);
