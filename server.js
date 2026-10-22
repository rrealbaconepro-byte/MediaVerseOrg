
"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// Keep private files outside the public directory.
const PUBLIC_DIR = path.join(__dirname, "public");
const HTML_FILE = path.join(__dirname, "Miiverse (very unfinished).html");

app.disable("x-powered-by");

// Security headers.
// CSP is temporarily disabled to avoid breaking existing page scripts.
// Configure a strict Content-Security-Policy after checking the HTML.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: {
      policy: "same-origin-allow-popups",
    },
  })
);

// Do not accept unnecessarily large request bodies.
app.use(express.json({ limit: "32kb", strict: true }));
app.use(
  express.urlencoded({
    extended: false,
    limit: "16kb",
    parameterLimit: 50,
  })
);

// Basic request-rate limit. This is an in-memory limit for one server process.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: "Too many requests. Please try again later.",
    },
    handler: (req, res, next, options) => {
      res.status(options.statusCode).json(options.message);
    },
  })
);

// Serve only files deliberately placed in the public directory.
// Never expose the entire project directory as a static website.
app.use(
  express.static(PUBLIC_DIR, {
    dotfiles: "deny",
    index: false,
    fallthrough: true,
    redirect: false,
    maxAge: IS_PRODUCTION ? "1h" : 0,
    immutable: false,
  })
);

// Serve the existing homepage without exposing other root files.
app.get("/", (req, res, next) => {
  res.sendFile(HTML_FILE, (err) => {
    if (err) next(err);
  });
});

// Friendly response for unknown routes.
app.use((req, res) => {
  res.status(404).send("Page not found.");
});

// Do not send internal errors or stack traces to visitors.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.type === "entity.too.large") {
    return res.status(413).send("Request too large.");
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).send("Invalid request.");
  }

  // Log a short error message on the server, not to the visitor.
  console.error("Request failed:", err.message);

  res.status(500).send("Something went wrong. Please try again later.");
});

// Verify the homepage exists before starting.
if (!fs.existsSync(HTML_FILE)) {
  console.error("Startup failed: the homepage HTML file was not found.");
  process.exit(1);
}

if (!fs.existsSync(PUBLIC_DIR) || !fs.statSync(PUBLIC_DIR).isDirectory()) {
  console.error(
    'Startup failed: create a "public" directory for public website assets.'
  );
  process.exit(1);
}

const server = http.createServer(
  { maxHeaderSize: 16 * 1024 },
  app
);

// Limit how long clients can take to send requests and headers.
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`MediaVerse server running on port ${PORT}`);
});
