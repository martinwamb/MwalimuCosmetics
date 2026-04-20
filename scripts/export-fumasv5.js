/**
 * Step 1: Export products from FumasV5 MySQL → products.json
 * Run this on the machine where FumasV5/MySQL is installed:
 *   node scripts/export-fumasv5.js
 *
 * Requires: npm install mysql2
 * Output:   scripts/products.json
 */

const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const DB_CONFIG = {
  host: "127.0.0.1",   // or "server-pc" if connecting over LAN
  port: 3306,
  user: "root",
  password: "WBzj%XK9",  // decoded from FumasV5.exe.config (4QtSMVxYPJA=)
  database: "mwalimuinvest",
};

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);
  console.log("Connected to MySQL mwalimuinvest");

  // Show available tables so we can identify the product table
  const [tables] = await conn.query("SHOW TABLES");
  console.log("\nTables in mwalimuinvest:");
  tables.forEach((row) => console.log(" -", Object.values(row)[0]));

  // Try common product table names
  const candidateTables = ["products", "product", "items", "stock", "inventory", "tblproducts", "tbl_products", "stock_items"];
  let productTable = null;

  for (const table of candidateTables) {
    const exists = tables.some((row) => Object.values(row)[0] === table);
    if (exists) {
      productTable = table;
      break;
    }
  }

  if (!productTable) {
    console.log("\nCould not auto-detect product table. Please check the table names above and set productTable manually.");
    console.log("Then re-run this script.");
    process.exit(1);
  }

  console.log(`\nFound product table: ${productTable}`);

  // Describe the table so we can see columns
  const [cols] = await conn.query(`DESCRIBE \`${productTable}\``);
  console.log("\nColumns:");
  cols.forEach((c) => console.log(` - ${c.Field} (${c.Type})`));

  // Fetch all products
  const [rows] = await conn.query(`SELECT * FROM \`${productTable}\``);
  console.log(`\nFound ${rows.length} products`);

  // Auto-map columns — adjust these if your column names differ
  const fieldMap = {
    // target field : possible source column names (first match wins)
    id:             ["id", "product_id", "ProductID", "productid", "ItemID"],
    name:           ["name", "product_name", "ProductName", "item_name", "ItemName", "description", "Description"],
    sku:            ["sku", "SKU", "code", "Code", "barcode", "Barcode", "product_code", "ProductCode", "ItemCode"],
    brand:          ["brand", "Brand", "manufacturer", "Manufacturer"],
    retailPrice:    ["retail_price", "RetailPrice", "price", "Price", "selling_price", "SellingPrice", "price1", "Price1", "UnitPrice"],
    wholesalePrice: ["wholesale_price", "WholesalePrice", "price2", "Price2", "WholesaleSellingPrice"],
    specialPrice:   ["special_price", "SpecialPrice", "price3", "Price3", "SpecialSellingPrice"],
    cost:           ["cost", "Cost", "cost_price", "CostPrice", "buying_price", "BuyingPrice", "purchase_price"],
    stockQty:       ["stock_qty", "StockQty", "quantity", "Quantity", "qty", "Qty", "stock", "Stock", "balance", "Balance"],
    category:       ["category", "Category", "category_name", "CategoryName"],
    description:    ["description", "Description", "notes", "Notes", "details"],
  };

  function pick(row, candidates) {
    for (const c of candidates) {
      if (row[c] !== undefined && row[c] !== null && row[c] !== "") {
        return row[c];
      }
    }
    return null;
  }

  const mapped = rows.map((row, idx) => {
    const retailPrice = parseFloat(pick(row, fieldMap.retailPrice)) || 0;
    const wholesalePriceRaw = parseFloat(pick(row, fieldMap.wholesalePrice));
    const specialPriceRaw = parseFloat(pick(row, fieldMap.specialPrice));
    const costRaw = parseFloat(pick(row, fieldMap.cost));

    const rawName = pick(row, fieldMap.name) ?? `Product ${idx + 1}`;
    const rawSku = String(pick(row, fieldMap.sku) ?? `SKU-${idx + 1}`).trim();

    return {
      name: String(rawName).trim(),
      sku: rawSku,
      brand: pick(row, fieldMap.brand) ? String(pick(row, fieldMap.brand)).trim() : null,
      price: retailPrice,
      wholesalePrice: isNaN(wholesalePriceRaw) || wholesalePriceRaw <= 0 ? null : wholesalePriceRaw,
      specialPrice: isNaN(specialPriceRaw) || specialPriceRaw <= 0 ? null : specialPriceRaw,
      cost: isNaN(costRaw) || costRaw < 0 ? 0 : costRaw,
      stockQty: parseInt(pick(row, fieldMap.stockQty)) || 0,
      category: pick(row, fieldMap.category) ? String(pick(row, fieldMap.category)).trim() : null,
      description: pick(row, fieldMap.description) ? String(pick(row, fieldMap.description)).trim() : null,
      status: "ACTIVE",
      currency: "KES",
    };
  }).filter((p) => p.name && p.sku && p.price > 0);

  const outPath = path.join(__dirname, "products.json");
  fs.writeFileSync(outPath, JSON.stringify(mapped, null, 2));
  console.log(`\nExported ${mapped.length} products → ${outPath}`);

  await conn.end();
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
