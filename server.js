
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

const ROOT_DIR = __dirname;
const HTML_FILE = path.join(ROOT_DIR, "index.html");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");

app.disable("x-powered-by");

app.use(
  helmet({
    // Keep CSP disabled temporarily to avoid breaking existing page scripts.
    contentSecurityPolicy: false,
  })
);

app.use(express.json({ limit: "32kb", strict: true }));
app.use(
  express.urlencoded({
    extended: false,
    limit: "16kb",
    parameterLimit: 50,
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later." },
  })
);

// Serve only assets deliberately placed in public/.
if (fs.existsSync(PUBLIC_DIR) && fs.statSync(PUBLIC_DIR).isDirectory()) {
  app.use(
    express.static(PUBLIC_DIR, {
      dotfiles: "deny",
      index: false,
      fallthrough: true,
      redirect: false,
      maxAge: IS_PRODUCTION ? "1h" : 0,
    })
  );
}

app.get("/", (req, res, next) => {
  res.sendFile(HTML_FILE, (err) => {
    if (err) next(err);
  });
});

app.use((req, res) => {
  res.status(404).send("Page not found.");
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.type === "entity.too.large") {
    return res.status(413).send("Request too large.");
  }

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).send("Invalid request.");
  }

  console.error("Request failed:", err.message);
  res.status(500).send("Something went wrong. Please try again later.");
});

if (!fs.existsSync(HTML_FILE)) {
  console.error("Startup failed: index.html was not found.");
  process.exit(1);
}

const server = http.createServer(
  { maxHeaderSize: 16 * 1024 },
  app
);

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`MediaVerse server running on port ${PORT}`);
});
