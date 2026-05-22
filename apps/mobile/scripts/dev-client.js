const net = require('net');
const { spawn } = require('child_process');

const defaultPorts = [8081, 8082, 8083, 8084, 8085];

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1' }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findOpenPort() {
  const requestedPort = process.argv[2] || process.env.EXPO_PORT;
  if (requestedPort) {
    const port = Number(requestedPort);
    if (!Number.isNaN(port) && port > 0 && port < 65536) {
      const available = await checkPort(port);
      if (available) {
        return port;
      }
      console.warn(`Requested port ${port} is unavailable.`);
    }
  }

  for (const port of defaultPorts) {
    const available = await checkPort(port);
    if (available) {
      return port;
    }
  }

  throw new Error(`No available ports found: ${defaultPorts.join(', ')}`);
}

(async () => {
  try {
    const port = await findOpenPort();
    console.log(`Starting Expo dev client on port ${port}...`);

    const child = spawn('npx', ['expo', 'start', '--dev-client', '--non-interactive', '--port', `${port}`], {
      stdio: 'inherit',
      shell: true,
    });

    const cleanup = () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    child.on('exit', (code) => {
      process.exit(code);
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();