import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve uploads directory relative to the backend package, overridable via env.
const defaultUploadsDir = path.resolve(__dirname, "..", "..", "uploads");

export const uploadsDir = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : defaultUploadsDir;
