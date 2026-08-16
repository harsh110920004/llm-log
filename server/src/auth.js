import jwt from "jsonwebtoken";

const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  return process.env.JWT_SECRET;
};

export function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, secret(), { expiresIn: "7d" });
}

export function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required" });
    req.user = jwt.verify(token, secret());
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
