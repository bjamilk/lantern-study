/**
 * PM2 Ecosystem Configuration for Lantern Study API
 * 
 * This configuration enables horizontal scaling across multiple CPU cores.
 * 
 * Usage:
 *   Development: pm2 start ecosystem.config.js --env development
 *   Production:  pm2 start ecosystem.config.js --env production
 *   
 * Commands:
 *   pm2 start ecosystem.config.js     - Start all apps
 *   pm2 reload ecosystem.config.js    - Zero-downtime reload
 *   pm2 stop all                      - Stop all apps
 *   pm2 delete all                    - Delete all apps
 *   pm2 logs                          - View logs
 *   pm2 monit                         - Monitor CPU/Memory
 *   pm2 save                          - Save current process list
 */

module.exports = {
  apps: [
    {
      name: 'lantern-api',
      script: './dist/server.js', // Compiled TypeScript output
      
      // Cluster mode for horizontal scaling
      instances: 'max', // Use all available CPUs (or set to specific number like 4)
      exec_mode: 'cluster', // Enable cluster mode
      
      // Automatic restarts
      autorestart: true,
      watch: false, // Set to true in development to auto-reload on file changes
      max_restarts: 10,
      min_uptime: '10s',
      
      // Memory management
      max_memory_restart: '1G', // Restart if memory exceeds 1GB per instance
      
      // Environment variables (production defaults)
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
        REDIS_ENABLED: 'false',
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3001,
        REDIS_ENABLED: 'false',
        instances: 2, // Use fewer instances in development
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
        REDIS_ENABLED: 'true',
        REDIS_URL: 'redis://localhost:6379',
      },
      
      // Graceful shutdown
      kill_timeout: 10000, // Wait 10 seconds before force kill
      listen_timeout: 5000, // Wait 5 seconds for app to start
      
      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      
      // Zero-downtime reload
      wait_ready: true, // Wait for process.send('ready') before considering started
      shutdown_with_message: true, // Send SIGINT before SIGKILL
      
      // Load balancing
      increment_var: 'PORT', // Uncomment to use different ports per instance
      
      // Health monitoring
      exp_backoff_restart_delay: 100, // Exponential backoff on restarts
    },
    {
      name: 'lantern-worker',
      script: './dist/worker.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        BULLMQ_ENABLED: 'false',
        REDIS_ENABLED: 'false',
      },
      env_production: {
        NODE_ENV: 'production',
        BULLMQ_ENABLED: 'true',
        REDIS_ENABLED: 'true',
        REDIS_URL: 'redis://localhost:6379',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-worker-error.log',
      out_file: './logs/pm2-worker-out.log',
      merge_logs: true,
    },
  ],
  
  // Deploy configuration (optional - for automated deployments)
  deploy: {
    production: {
      user: 'deploy',
      host: ['server1.example.com', 'server2.example.com'],
      ref: 'origin/main',
      repo: 'git@github.com:username/lantern-study.git',
      path: '/var/www/lantern-api',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
    },
  },
};
