const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const port = Number(process.env.PORT || 5500);
const host = process.env.HOST || "0.0.0.0";
const dataDir = process.env.STOCKSYNC_DATA_DIR || path.join(root, "data");
const dbPath = process.env.STOCKSYNC_DB || path.join(dataDir, "stocksync-db.json");
const maxBodyBytes = 50 * 1024 * 1024;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon"
};

function garantirBanco() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    salvarBanco({
      meta: {
        app: "StockSync",
        criadoEm: new Date().toISOString(),
        versao: 1
      },
      storage: {}
    });
  }
}

function lerBanco() {
  garantirBanco();
  try {
    const texto = fs.readFileSync(dbPath, "utf8");
    const banco = JSON.parse(texto || "{}");
    if (!banco.storage || typeof banco.storage !== "object") banco.storage = {};
    return banco;
  } catch (error) {
    const backup = `${dbPath}.${Date.now()}.corrompido`;
    if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, backup);
    const banco = {
      meta: {
        app: "StockSync",
        criadoEm: new Date().toISOString(),
        recuperadoEm: new Date().toISOString(),
        backupCorrompido: path.basename(backup),
        versao: 1
      },
      storage: {}
    };
    salvarBanco(banco);
    return banco;
  }
}

function salvarBanco(banco) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const temporario = `${dbPath}.tmp`;
  banco.meta = {
    ...(banco.meta || {}),
    atualizadoEm: new Date().toISOString()
  };
  fs.writeFileSync(temporario, JSON.stringify(banco, null, 2), "utf8");
  fs.renameSync(temporario, dbPath);
}

function responderJSON(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept"
  });
  res.end(JSON.stringify(payload));
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBodyBytes) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      partes.push(chunk);
    });

    req.on("end", () => {
      const texto = Buffer.concat(partes).toString("utf8");
      if (!texto) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(texto));
      } catch (error) {
        reject(new Error("INVALID_JSON"));
      }
    });

    req.on("error", reject);
  });
}

function chaveValida(chave) {
  return /^ge_(empresas|solicitacoes_funcionarios|dados_[a-z0-9_-]+)$/i.test(chave);
}

async function tratarAPI(req, res, url) {
  if (req.method === "OPTIONS") {
    responderJSON(res, 204, {});
    return true;
  }

  if (url.pathname === "/api/health") {
    const banco = lerBanco();
    responderJSON(res, 200, {
      ok: true,
      app: "StockSync",
      storageKeys: Object.keys(banco.storage).length,
      databaseId: crypto.createHash("sha1").update(dbPath).digest("hex").slice(0, 8)
    });
    return true;
  }

  if (url.pathname === "/api/export" && req.method === "GET") {
    responderJSON(res, 200, lerBanco());
    return true;
  }

  if (url.pathname === "/api/import" && req.method === "POST") {
    try {
      const corpo = await lerCorpo(req);
      if (!corpo || typeof corpo.storage !== "object") {
        responderJSON(res, 400, { ok: false, erro: "Arquivo de banco inválido." });
        return true;
      }
      salvarBanco({ meta: { app: "StockSync", importadoEm: new Date().toISOString(), versao: 1 }, storage: corpo.storage });
      responderJSON(res, 200, { ok: true });
    } catch (error) {
      responderJSON(res, 400, { ok: false, erro: "Não foi possível importar o banco." });
    }
    return true;
  }

  if (url.pathname.startsWith("/api/storage/")) {
    const chave = decodeURIComponent(url.pathname.replace("/api/storage/", ""));
    if (!chaveValida(chave)) {
      responderJSON(res, 400, { ok: false, erro: "Chave de banco inválida." });
      return true;
    }

    const banco = lerBanco();

    if (req.method === "GET") {
      const existe = Object.prototype.hasOwnProperty.call(banco.storage, chave);
      responderJSON(res, 200, { ok: true, exists: existe, value: existe ? banco.storage[chave] : null });
      return true;
    }

    if (req.method === "PUT" || req.method === "POST") {
      try {
        const corpo = await lerCorpo(req);
        banco.storage[chave] = corpo.value;
        salvarBanco(banco);
        responderJSON(res, 200, { ok: true });
      } catch (error) {
        responderJSON(res, error.message === "BODY_TOO_LARGE" ? 413 : 400, { ok: false, erro: "Não foi possível salvar no banco." });
      }
      return true;
    }
  }

  return false;
}

function servirArquivo(res, pathname) {
  const file = path.normalize(path.join(root, pathname));

  if (!file.startsWith(root)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Acesso negado");
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Arquivo nao encontrado");
      return;
    }

    res.writeHead(200, {
      "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);

  try {
    if (await tratarAPI(req, res, url)) return;
  } catch (error) {
    responderJSON(res, 500, { ok: false, erro: "Erro interno do servidor." });
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/01-login.html";
  servirArquivo(res, pathname);
}).listen(port, host, () => {
  garantirBanco();
  const localUrl = `http://localhost:${port}/01-login.html`;
  console.log(`StockSync rodando em ${localUrl}`);
  console.log(`Banco de dados: ${dbPath}`);
});
