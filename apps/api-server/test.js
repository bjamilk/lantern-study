const http = require('http');

const server = http.createServer((req, res) => {
  console.log(`Request: ${req.method} ${req.url}`);
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(8080, '0.0.0.0', () => {
  console.log('Test server running on port 8080');
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

server.on('listening', () => {
  console.log('Server is now listening');
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down');
  server.close();
});