import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

export type AuthPayload = {
  sub: string;
  email: string;
  role: string;
};

function parseAuthHeader(header?: string | null): string | null {
  if (!header) return null;
  if (!header.startsWith("Bearer ")) return null;
  return header.replace("Bearer ", "").trim();
}

export function verifyAuth(header?: string | null): AuthPayload | null {
  const token = parseAuthHeader(header);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthPayload;
    return payload;
  } catch (_err) {
    return null;
  }
}

export function requireAuth(req: any, res: any, next: any) {
  const payload = verifyAuth(req.headers.authorization);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  req.user = payload;
  return next();
}

export function requireRoles(roles: string[]) {
  return (req: any, res: any, next: any) => {
    const payload = verifyAuth(req.headers.authorization);
    if (!payload) return res.status(401).json({ error: "Unauthorized" });
    if (!roles.includes(payload.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    req.user = payload;
    return next();
  };
}
