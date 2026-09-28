module.exports = {
  apps: [
    {
      name: 'devpanel',
      script: 'server.js',
      cwd: __dirname,
      env: {
        PORT: 8888,
        NODE_ENV: 'production'
      },
      watch: false,
      max_memory_restart: '150M'
    }
  ]
};
