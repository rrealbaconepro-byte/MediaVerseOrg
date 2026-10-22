
"use strict";

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const ROOT = path.resolve(__dirname);

// --------------------------------------------------
// 1. Startup validation
// --------------------------------------------------

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("Invalid server port configuration.");
}

// --------------------------------------------------
// 2. Reverse proxy configuration
// Render terminates HTTPS at its load balancer.
// Trust only the expected single proxy hop.
// Verify this matches your Render deployment.
// --------------------------------------------------

if (process.env.RENDER === "true") {
  app.set("trust proxy", 1);
} else {
  app.set("trust proxy", false);
}

// --------------------------------------------------
// 3. Reduce server fingerprinting
// --------------------------------------------------

app.disable("x-powered-by");
app.disable("etag");

// --------------------------------------------------
// 4. Security headers
// CSP is deliberately disabled until your existing
// index.html and Firebase domains are inspected.
// Add a tailored CSP before enabling it.
// --------------------------------------------------

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: IS_PRODUCTION
      ? {
          maxAge: 31536000,
          includeSubDomains: false,
          preload: false,
        }
      : false,
  })
);

// Prevent caching of server-generated responses by default.
app.use((req, res, next) => {
  res.setHeader("X-Request-ID", crypto.randomUUID());
  res.setHeader("Cache-Control", "no-store");
  next();
});

// --------------------------------------------------
// 5. Request-method restrictions
// This server serves a website, not a general API.
// Add explicit routes before this guard if you need
// server-side POST/PUT/PATCH/DELETE endpoints.
// --------------------------------------------------

app.use((req, res, next) => {
  if (!["GET", "HEAD"].includes(req.method)) {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({
      error: "Method not allowed.",
    });
  }

  next();
});

// --------------------------------------------------
// 6. Global rate limiting
// This is a per-process memory limiter, not a
// distributed DDoS defense.
// Tune limits for real traffic.
// --------------------------------------------------

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please try again later.",
  },
});

app.use(globalLimiter);

// --------------------------------------------------
// 7. Limit request body sizes
// The current static website does not need request
// bodies. Keep parsers ready only if you later add APIs.
// --------------------------------------------------

app.use(express.json({ limit: "32kb", strict: true }));
app.use(
  express.urlencoded({
    extended: false,
    limit: "16kb",
    parameterLimit: 50,
  })
);

// --------------------------------------------------
// 8. Basic malformed URL and input checks
// Never treat these checks as a replacement for
// route-specific validation.
// --------------------------------------------------

app.use((req, res, next) => {
  if (
    typeof req.url !== "string" ||
    req.url.length > 4096 ||
    req.url.includes("\0") ||
    req.url.includes("\\")
  ) {
    return res.status(400).json({
      error: "Invalid request.",
    });
  }

  next();
});

// --------------------------------------------------
// 9. Health endpoint
// Exposes no secrets, configuration, or database data.
// --------------------------------------------------

app.get("/health", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
});

// --------------------------------------------------
// 10. Safely serve existing website files
// Keep index.html in the repository root.
// Dotfiles and directory listings are disabled.
// --------------------------------------------------

app.use(
  express.static(ROOT, {
    dotfiles: "deny",
    index: false,
    redirect: false,
    fallthrough: true,
    extensions: ["html"],
    maxAge: IS_PRODUCTION ? "1h" : 0,
    setHeaders(res, filePath) {
      // Never publicly cache HTML documents.
      if (path.extname(filePath).toLowerCase() === ".html") {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  })
);

// --------------------------------------------------
// 11. Homepage
// --------------------------------------------------

app.get("/", (req, res, next) => {
  res.sendFile(
    path.join(ROOT, "index.html"),
    {
      dotfiles: "deny",
      headers: {
        "Cache-Control": "no-store",
      },
    },
    (err) => {
      if (err && !res.headersSent) {
        next(err);
      }
    }
  );
});

// --------------------------------------------------
// 12. Safe not-found response
// --------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: "Page not found.",
  });
});

// --------------------------------------------------
// 13. Central error handling
// Never send stack traces or internal paths to visitors.
// --------------------------------------------------

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  // Log only a request ID and error category.
  // Avoid logging cookies, tokens, request bodies,
  // query strings, or other sensitive user data.
  console.error("Request failed", {
    requestId: res.getHeader("X-Request-ID"),
    status: Number.isInteger(err.status) ? err.status : 500,
    type: err.type || err.name || "Error",
  });

  if (err.type === "entity.too.large") {
    return res.status(413).json({
      error: "Request too large.",
    });
  }

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "Invalid request body.",
    });
  }

  const status =
    Number.isInteger(err.status) &&
    err.status >= 400 &&
    err.status < 500
      ? err.status
      : 500;

  res.status(status).json({
    error: status >= 500
      ? "An internal server error occurred."
      : "Invalid request.",
  });
});

// --------------------------------------------------
// 14. Start server
// Render requires binding to 0.0.0.0.
// --------------------------------------------------

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`MediaVerse server listening on port ${PORT}`);
});

// --------------------------------------------------
// 15. Graceful shutdown
// --------------------------------------------------

function shutdown(signal) {
  console.log(`Received ${signal}; closing server.`);

  server.close((err) => {
    if (err) {
      console.error("Server shutdown failed.");
      process.exitCode = 1;
    }
  });

  // A deployment manager can terminate the process
  // if it fails to exit within its shutdown window.
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

module.exports = app;
