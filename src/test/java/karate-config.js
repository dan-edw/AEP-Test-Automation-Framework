function fn() {
  var env = karate.env; // get system property 'karate.env'
    karate.log('=== Karate Configuration ===');
    karate.log('Environment:', env);
  
  if (!env) {
    env = 'dev';
    karate.log('No env specified, defaulting to:', env);
  }
//   Set default baseUrl
  var config = {
    env: env,
    baseUrl: 'https://tessera-api.dev-tools.hq.local', 
    timeout: 30000 // Request timeout in milliseconds
  };
  
  // Environment-specific configuration -Override based on environment
  if (env === 'dev') {
    config.baseUrl = 'https://tessera-api.dev-tools.hq.local';
  } else if (env === 'qa') {
    config.baseUrl = 'https://tessera-api.dev-tools.hq.local';
  } else if (env === 'prod') {
    config.baseUrl = 'https://tessera-api.dev-tools.hq.local';
  }
  
  // Configure HTTP client settings
  karate.configure('connectTimeout', config.timeout);
  karate.configure('readTimeout', config.timeout);
  
  // SSL configuration for internal domains
  karate.configure('ssl', true); // Enable SSL
  // karate.configure('ssl', { trustAll: true }); // Uncomment if SSL cert issues
  
  // HTTP client retry configuration
  karate.configure('retry', { count: 3, interval: 2000 });
  
  return config;
}
