/**
 * Step 2: Import products.json → PostgreSQL (live database)
 * Run from the project root on the server or locally with a tunnel:
 *   DATABASE_URL="postgresql://..." node scripts/import-products.js
 *
 * This script is safe to re-run — it uses upsert (skips duplicates by SKU).
 */

const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

function slugify(name, sku) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
  return `${base}-${sku.toLowerCase().replace(/[^a-z0-9]/g, "-")}`.slice(0, 120);
}

async function main() {
  const filePath = path.join(__dirname, "products.json");
  if (!fs.existsSync(filePath)) {
    console.error("products.json not found. Run export-fumasv5.js first.");
    process.exit(1);
  }

  const products = JSON.parse(fs.readFileSync(filePath, "utf8"));
  console.log(`Importing ${products.length} products...`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const p of products) {
    try {
      const slug = slugify(p.name, p.sku);

      // Resolve or create category
      let categoryId = null;
      if (p.category) {
        const cat = await prisma.category.upsert({
          where: { name: p.category },
          create: { name: p.category },
          update: {},
        });
        categoryId = cat.id;
      }

      const existing = await prisma.product.findUnique({ where: { sku: p.sku } });

      if (existing) {
        await prisma.product.update({
          where: { sku: p.sku },
          data: {
            name: p.name,
            brand: p.brand,
            price: p.price,
            wholesalePrice: p.wholesalePrice,
            specialPrice: p.specialPrice,
            cost: p.cost,
            stockQty: p.stockQty,
            status: p.status,
            currency: p.currency,
            description: p.description,
            categoryId,
          },
        });
        updated++;
        process.stdout.write(`U`);
      } else {
        await prisma.product.create({
          data: {
            name: p.name,
            brand: p.brand ?? undefined,
            sku: p.sku,
            slug,
            price: p.price,
            wholesalePrice: p.wholesalePrice ?? undefined,
            specialPrice: p.specialPrice ?? undefined,
            cost: p.cost,
            stockQty: p.stockQty,
            status: p.status,
            currency: p.currency,
            description: p.description ?? undefined,
            categoryId,
          },
        });
        created++;
        process.stdout.write(`.`);
      }
    } catch (err) {
      console.error(`\nSkipped ${p.sku} (${p.name}): ${err.message}`);
      skipped++;
    }
  }

  console.log(`\n\nDone. Created: ${created}, Updated: ${updated}, Skipped: ${skipped}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  prisma.$disconnect();
  process.exit(1);
});
