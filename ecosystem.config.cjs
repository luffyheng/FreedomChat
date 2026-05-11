// PM2 process definition.
//
//   Start:    pm2 start ecosystem.config.cjs --env production
//   Reload:   pm2 reload blast-chatmamba
//   Logs:     pm2 logs blast-chatmamba
//   Save:     pm2 save     (after first start, so it auto-restarts on reboot)

module.exports = {
  apps: [
    {
      name: 'blast-chatmamba',
      cwd: __dirname,
      script: 'server/src/index.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      max_memory_restart: '600M',
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'development',
        PORT: 4011,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 4011,
        CLIENT_ORIGIN: 'https://blast.ayadvisorysolution.com',
        APP_ORIGIN:    'https://blast.ayadvisorysolution.com',
        // ADMIN_EMAIL / ADMIN_PASSWORD are read from server/.env on first boot
      },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
