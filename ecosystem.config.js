module.exports = {
  apps: [
    {
      name: 'note-backend',
      cwd: './backend',
      script: 'dist/index.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001
      }
    },
    {
      name: 'note-frontend',
      cwd: './frontend',
      script: 'npm',
      args: 'start -- -p 3000',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
