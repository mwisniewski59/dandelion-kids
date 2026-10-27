// ============================================================
// BST FLOW / DANDELION KIDS — Shared Supabase config
// Every page (intake, offer, dashboard, signup) loads this file.
//
// ENVIRONMENT SWITCH
//   - bstflow.com / www.bstflow.com  -> LIVE database (real shop data)
//   - anything else (Vercel *.vercel.app previews, localhost, 127.0.0.1,
//     file previews, etc.)          -> STAGING database (fake data only)
//
// This means a preview deploy or a local test can never write to the
// live shop's data by accident. Only the production domain talks to LIVE.
//
// Both keys below are the PUBLIC anon keys (safe to ship in a browser);
// access is controlled by Row Level Security in each database.
// ============================================================

(function () {
  var LIVE = {
    SUPABASE_URL: 'https://acmjbeatbwetjmkibfvm.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjbWpiZWF0YndldGpta2liZnZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTM3OTgsImV4cCI6MjA5NDc4OTc5OH0.9Du9L2i_Ku3m2cW0_Md8mZutfDpMC-5HYnY1TV0FUCU'
  };

  var STAGING = {
    SUPABASE_URL: 'https://qngqrvgcqunywyemzesy.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuZ3FydmdjcXVueXd5ZW16ZXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNTQxMTcsImV4cCI6MjEwODYzMDExN30.saEpDg6euLldTX-lvwcxsUbeXGBrt9Xnm0IJAyDsR2Y'
  };

  var LIVE_HOSTS = ['bstflow.com', 'www.bstflow.com'];
  var host = String((window.location && window.location.hostname) || '').toLowerCase();
  var isLive = LIVE_HOSTS.indexOf(host) !== -1;
  var env = isLive ? LIVE : STAGING;

  window.DANDELION_CONFIG = {
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,

    // Which database this page is talking to: 'live' or 'staging'.
    ENV: isLive ? 'live' : 'staging',

    // Public base URL the customer offer page lives at.
    // Used when building offer links and copy-paste offer emails.
    PUBLIC_BASE_URL: window.location.origin
  };
})();
