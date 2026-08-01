/**
 * @mwalimu/fumas-core
 *
 * The contract layer for the `mwalimuinvest` MySQL database.
 *
 * Everything the desktop app and the sync agent both need in order to read and
 * write the shop's books correctly lives here, so the two cannot drift apart.
 * Drift between them would mean two programs disagreeing about the accounts,
 * which is the failure mode this package exists to prevent.
 */

export {
  encryptPassword,
  decryptPassword,
  verifyCryptoAvailable,
  GOLDEN_VECTORS,
  LEGACY_KEY,
  LEGACY_IV,
} from "./crypto/password";

export {
  toCents,
  fromCents,
  centsToSqlString,
  parseMoney,
  computeLine,
  headerAmount,
  sumVat,
  sumDiscount,
  assertBalanced,
  UnbalancedLedgerError,
  type Cents,
  type LineInput,
  type LineAmounts,
  type GlLeg,
} from "./money";
