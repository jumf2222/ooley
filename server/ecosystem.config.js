module.exports = {
  apps: [
    {
      name: "server",
      script: "index.js",
      instances: 1,
      merge_logs: true,
      max_restarts: 50,
      out_file: "/home/ubuntu/server/log.log",
      error_file: "/home/ubuntu/server/log.log",
      log_date_format: "YYYY-MM-DD HH:mm Z",
    },
  ],
};
