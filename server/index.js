const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const { PORT } = require('./config');
const { registerConnection } = require('./ws/connectionHandler');
const RoomManager = require('./rooms/RoomManager');

const CLIENT_DIR = path.join(__dirname, '..', 'client');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/**
 * Servidor HTTP simples apenas para servir os arquivos estaticos do client
 * (nesta etapa nao ha necessidade de um framework como Express).
 */
function serveStaticFile(req, res) {
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(CLIENT_DIR, filePath);

  // Evita path traversal simples.
  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// Rota de saude simples, util para debug manual.
function handleHttpRequest(req, res) {
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, activeRooms: RoomManager.getActiveRoomCount() }));
  }
  return serveStaticFile(req, res);
}

const httpServer = http.createServer(handleHttpRequest);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => registerConnection(ws));

httpServer.listen(PORT, () => {
  console.log(`Servidor multiplayer rodando em http://localhost:${PORT}`);
  console.log('WebSocket disponivel no mesmo endereco/porta.');
});
