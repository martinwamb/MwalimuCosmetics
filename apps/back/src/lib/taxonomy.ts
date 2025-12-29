import { HomepageRuleType, HomepageSort, Prisma, TagSelection } from "@prisma/client";

import { prisma } from "./prisma.js";

type SystemGroupConfig = {
  code: string;
  name: string;
  description?: string;
  selection: TagSelection;
  required: boolean;
  editable: boolean;
  values: string[];
  min?: number;
  max?: number;
};

type NormalizedTags = {
  product_type: string[];
  care_area: string[];
  benefit: string[];
  suitable_for: string[];
  ingredient: string[];
  marketing: string[];
};

type StructuredTagInput = {
  productType?: string;
  careAreas?: string[];
  benefits?: string[];
  suitableFor?: string[];
  ingredients?: string[];
  marketingTags?: string[];
};

type RuleValue = string | string[] | undefined | null;

export type ProductRule = {
  type: HomepageRuleType;
  value?: RuleValue;
  limit?: number;
  sort?: HomepageSort;
};

export const SYSTEM_TAG_GROUPS: SystemGroupConfig[] = [
  {
    code: "product_type",
    name: "Product Type",
    selection: TagSelection.SINGLE,
    required: true,
    editable: false,
    min: 1,
    max: 1,
    values: [
      "hair_oil",
      "hair_food",
      "hair_treatment",
      "hair_dye",
      "lotion",
      "cream",
      "body_oil",
      "cleanser",
      "toner",
      "serum",
      "shower_gel",
      "soap",
      "scrub",
      "deodorant_roll_on",
      "deodorant_spray",
      "lip_care",
      "sunscreen"
    ]
  },
  {
    code: "care_area",
    name: "Care Area",
    selection: TagSelection.MULTI,
    required: true,
    editable: false,
    min: 1,
    values: ["hair", "scalp", "face", "body", "underarm", "hands_feet"]
  },
  {
    code: "benefit",
    name: "Benefits",
    selection: TagSelection.MULTI,
    required: false,
    editable: true,
    values: [
      "hair_growth",
      "anti_dandruff",
      "strengthening",
      "repairing",
      "moisturizing",
      "shine_gloss",
      "anti_breakage",
      "brightening",
      "even_tone",
      "anti_acne",
      "soothing",
      "hydrating",
      "firming",
      "exfoliating",
      "odour_control",
      "anti_perspirant"
    ]
  },
  {
    code: "suitable_for",
    name: "Suitable For",
    selection: TagSelection.MULTI,
    required: false,
    editable: true,
    values: [
      "dry_skin",
      "oily_skin",
      "combination_skin",
      "sensitive_skin",
      "normal_skin",
      "natural_hair",
      "relaxed_hair",
      "colored_hair",
      "damaged_hair",
      "low_porosity",
      "high_porosity"
    ]
  },
  {
    code: "ingredient",
    name: "Ingredients / Formula",
    selection: TagSelection.MULTI,
    required: false,
    editable: true,
    values: [
      "shea_butter",
      "coconut_oil",
      "castor_oil",
      "olive_oil",
      "aloe_vera",
      "vitamin_e",
      "tea_tree",
      "glycolic_acid",
      "salicylic_acid",
      "niacinamide",
      "fragrance_free",
      "alcohol_free",
      "sulfate_free",
      "paraben_free"
    ]
  },
  {
    code: "marketing",
    name: "Marketing Tags",
    selection: TagSelection.MULTI,
    required: false,
    editable: false,
    values: ["new_arrival", "best_seller", "featured", "seasonal", "limited_offer"]
  }
];

const PRICE_BUCKETS = [
  { code: "under_500", test: (price: number) => price < 500 },
  { code: "under_1000", test: (price: number) => price < 1000 },
  { code: "under_2000", test: (price: number) => price < 2000 },
  { code: "premium", test: (price: number) => price >= 2000 }
];

const SYSTEM_GROUP_LOOKUP = SYSTEM_TAG_GROUPS.reduce<Record<string, SystemGroupConfig>>((acc, group) => {
  acc[group.code] = group;
  return acc;
}, {});

let taxonomyReady: Promise<void> | null = null;

function toLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function uniq(values?: string[]) {
  return Array.from(new Set((values ?? []).map((v) => v.trim()).filter(Boolean)));
}

async function syncSystemTaxonomy() {
  for (const group of SYSTEM_TAG_GROUPS) {
    const groupRecord = await prisma.tagGroup.upsert({
      where: { code: group.code },
      update: { name: group.name, description: group.description, selection: group.selection, required: group.required, editable: group.editable },
      create: {
        code: group.code,
        name: group.name,
        description: group.description,
        selection: group.selection,
        required: group.required,
        editable: group.editable
      }
    });

    for (const [idx, value] of group.values.entries()) {
      await prisma.tag.upsert({
        where: { groupId_value: { groupId: groupRecord.id, value } },
        update: { label: toLabel(value), sortOrder: idx, isSystem: true },
        create: { value, label: toLabel(value), isSystem: true, sortOrder: idx, groupId: groupRecord.id }
      });
    }
  }
}

export function ensureSystemTaxonomy() {
  if (!taxonomyReady) {
    taxonomyReady = syncSystemTaxonomy();
  }
  return taxonomyReady;
}

export function validateStructuredTags(input: StructuredTagInput): { ok: boolean; errors: string[]; normalized: NormalizedTags } {
  const normalized: NormalizedTags = {
    product_type: input.productType ? [input.productType] : [],
    care_area: uniq(input.careAreas),
    benefit: uniq(input.benefits),
    suitable_for: uniq(input.suitableFor),
    ingredient: uniq(input.ingredients),
    marketing: uniq(input.marketingTags)
  };

  const errors: string[] = [];

  const productTypeGroup = SYSTEM_GROUP_LOOKUP["product_type"];
  if (!normalized.product_type.length) {
    errors.push("Product type is required.");
  } else if (normalized.product_type.length !== 1) {
    errors.push("Select exactly one product type.");
  } else if (!productTypeGroup.values.includes(normalized.product_type[0])) {
    errors.push(`Invalid product type: ${normalized.product_type[0]}.`);
  }

  const careAreaGroup = SYSTEM_GROUP_LOOKUP["care_area"];
  if (!normalized.care_area.length) {
    errors.push("Select at least one care area.");
  } else if (normalized.care_area.some((value) => !careAreaGroup.values.includes(value))) {
    errors.push("One or more care areas are invalid.");
  }

  for (const code of ["benefit", "suitable_for", "ingredient", "marketing"] as const) {
    const group = SYSTEM_GROUP_LOOKUP[code];
    const values = normalized[code];
    if (values.length && !group.editable && values.some((value) => !group.values.includes(value))) {
      errors.push(`Invalid value for ${group.name}.`);
    }
  }

  return { ok: errors.length === 0, errors, normalized };
}

export async function persistProductTags(productId: string, tags: NormalizedTags, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  await ensureSystemTaxonomy();
  const groupCodes = Object.keys(tags);

  const groups = await tx.tagGroup.findMany({
    where: { code: { in: groupCodes } },
    include: { tags: true }
  });
  const groupByCode = new Map(groups.map((g) => [g.code, g]));

  for (const groupCode of groupCodes) {
    const group = groupByCode.get(groupCode);
    if (!group) {
      throw new Error(`Tag group ${groupCode} missing`);
    }
    const values = tags[groupCode as keyof NormalizedTags] ?? [];
    const existingByValue = new Map(group.tags.map((tag) => [tag.value, tag]));

    const missingValues = values.filter((val) => !existingByValue.has(val));
    if (missingValues.length) {
      if (!group.editable) {
        throw new Error(`Invalid ${group.name} value: ${missingValues.join(", ")}`);
      }
      for (const value of missingValues) {
        const created = await tx.tag.create({
          data: {
            value,
            label: toLabel(value),
            isSystem: false,
            sortOrder: group.tags.length + existingByValue.size,
            groupId: group.id
          }
        });
        existingByValue.set(value, created);
      }
    }

    await tx.productTag.deleteMany({ where: { productId, tag: { groupId: group.id } } });
    if (values.length) {
      await tx.productTag.createMany({
        data: values.map((value) => {
          const tag = existingByValue.get(value);
          if (!tag) throw new Error(`Missing tag ${value} for group ${group.name}`);
          return { productId, tagId: tag.id };
        })
      });
    }
  }
}

export function buildTagMap(productTags: { tag: { value: string; group: { code: string } } }[]): Record<string, string[]> {
  const byGroup: Record<string, string[]> = {};
  productTags.forEach((pt) => {
    const code = pt.tag.group.code;
    if (!byGroup[code]) byGroup[code] = [];
    byGroup[code].push(pt.tag.value);
  });
  Object.keys(byGroup).forEach((code) => {
    byGroup[code] = uniq(byGroup[code]);
  });
  return byGroup;
}

export function computePriceBuckets(price: number) {
  const buckets: string[] = [];
  for (const bucket of PRICE_BUCKETS) {
    if (bucket.test(price)) {
      buckets.push(bucket.code);
    }
  }
  return uniq(buckets);
}

export function computeAutoCategories(tags: Record<string, string[]>) {
  const categories: string[] = [];
  const careAreas = tags["care_area"] ?? [];
  const productTypes = tags["product_type"] ?? [];

  if (careAreas.some((c) => c === "hair" || c === "scalp")) {
    categories.push("Hair Care");
  }
  if (careAreas.includes("face")) {
    categories.push("Skin Care");
  }
  const bathTypes = ["shower_gel", "soap", "scrub", "lotion", "cream", "body_oil"];
  if (productTypes.some((t) => bathTypes.includes(t)) || careAreas.includes("body")) {
    categories.push("Bath & Body");
  }
  if (careAreas.includes("underarm") || productTypes.some((t) => t.startsWith("deodorant_"))) {
    categories.push("Personal Care");
  }

  return uniq(categories);
}

export function formatProduct(product: any, includeCost = false) {
  const price = parseFloat(product.price.toString());
  const compareAt = product.compareAtPrice ? parseFloat(product.compareAtPrice.toString()) : null;
  const onSale = typeof compareAt === "number" ? compareAt > price : false;
  const tags = buildTagMap(product.productTags ?? []);
  const priceBuckets = computePriceBuckets(price);
  const categories = computeAutoCategories(tags);
  const primaryCategory = categories[0] ?? null;

  const base: any = {
    id: product.id,
    name: product.name,
    brand: product.brand ?? null,
    sku: product.sku,
    slug: product.slug ?? null,
    shortDescription: product.shortDescription ?? null,
    description: product.description,
    featured: product.featured,
    imageUrl: product.imageUrl,
    galleryImages: product.galleryImages ?? [],
    price,
    compareAtPrice: compareAt,
    onSale,
    currency: product.currency ?? "KES",
    stockQty: product.stockQty,
    status: product.status,
    category: primaryCategory,
    categories,
    priceBuckets,
    productType: tags["product_type"]?.[0] ?? null,
    careAreas: tags["care_area"] ?? [],
    benefits: tags["benefit"] ?? [],
    suitableFor: tags["suitable_for"] ?? [],
    ingredients: tags["ingredient"] ?? [],
    marketingTags: tags["marketing"] ?? [],
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    variants:
      product.variants?.map((v: any) => ({
        id: v.id,
        name: v.name,
        imageUrl: v.imageUrl,
        price: v.price ? parseFloat(v.price.toString()) : null
      })) ?? []
  };

  if (includeCost) {
    base.cost = parseFloat(product.cost.toString());
  }
  return base;
}

function tagWhere(groupCode: string, values: string | string[]) {
  const list = Array.isArray(values) ? values : [values];
  return { productTags: { some: { tag: { group: { code: groupCode }, value: { in: list } } } } };
}

function buildOrder(sort?: HomepageSort) {
  switch (sort) {
    case HomepageSort.PRICE_ASC:
      return [{ price: "asc" as const }];
    case HomepageSort.PRICE_DESC:
      return [{ price: "desc" as const }];
    case HomepageSort.BEST_SELLING:
      return [{ createdAt: "desc" as const }];
    case HomepageSort.NEWEST:
    default:
      return [{ createdAt: "desc" as const }];
  }
}

export async function getProductsByRule(rule: ProductRule, options?: { includeCost?: boolean }) {
  await ensureSystemTaxonomy();
  const where: Prisma.ProductWhereInput = {
    status: { in: ["ACTIVE", "INACTIVE"] }
  };

  switch (rule.type) {
    case HomepageRuleType.MARKETING_TAG:
      if (rule.value) Object.assign(where, tagWhere("marketing", rule.value));
      break;
    case HomepageRuleType.CARE_AREA:
      if (rule.value) Object.assign(where, tagWhere("care_area", rule.value));
      break;
    case HomepageRuleType.PRODUCT_TYPE:
      if (rule.value) Object.assign(where, tagWhere("product_type", rule.value));
      break;
    case HomepageRuleType.BENEFIT:
      if (rule.value) Object.assign(where, tagWhere("benefit", rule.value));
      break;
    case HomepageRuleType.PRICE_BUCKET: {
      const value = Array.isArray(rule.value) ? rule.value[0] : rule.value;
      if (value === "under_500") where.price = { lt: 500 };
      else if (value === "under_1000") where.price = { lt: 1000 };
      else if (value === "under_2000") where.price = { lt: 2000 };
      else if (value === "premium") where.price = { gte: 2000 };
      break;
    }
    case HomepageRuleType.SPECIAL: {
      // Special rules are filtered post-query if needed
      break;
    }
    default:
      break;
  }

  const products = await prisma.product.findMany({
    where,
    include: { productTags: { include: { tag: { include: { group: true } } } }, variants: true },
    orderBy: buildOrder(rule.sort),
    take: Math.min(rule.limit ?? 20, 50)
  });

  let formatted = products.map((p) => formatProduct(p, options?.includeCost));
  if (rule.type === HomepageRuleType.SPECIAL && rule.value === "ON_SALE") {
    formatted = formatted.filter((p) => p.compareAtPrice !== null && typeof p.compareAtPrice === "number" && p.compareAtPrice > p.price);
  }

  return formatted;
}
