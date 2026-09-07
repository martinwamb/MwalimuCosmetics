import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve uploads directory relative to the backend package, overridable via env.
const defaultUploadsDir = path.resolve(__dirname, "..", "..", "uploads");

export const uploadsDir = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : defaultUploadsDir;

// Clock-in photos, deliberately NOT under uploadsDir.
//
// index.ts serves that whole directory with express.static and no auth, so a
// staff selfie put there would be readable by anybody who had the filename.
// These are read back only through GET /clockings/:id/photo/:which, which is
// ADMIN only.
//
// In production CLOCKINGS_DIR must be set to somewhere OUTSIDE the deployment
// directory, as UPLOADS_DIR already is. The deploy runs `rsync --delete`, so
// this default - which sits inside the tree - would have every photo in it
// removed on the next deploy, with nothing said. See .env.example.
const defaultClockingsDir = path.resolve(__dirname, "..", "..", "clockings");

export const clockingsDir = process.env.CLOCKINGS_DIR
  ? path.resolve(process.env.CLOCKINGS_DIR)
  : defaultClockingsDir;
