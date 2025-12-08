CREATE TABLE IF NOT EXISTS "ProductVariant" (
    "id" TEXT PRIMARY KEY,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "price" DECIMAL(12,2),
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
