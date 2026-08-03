// ============================================================
// DANDELION KIDS — Shared Supabase config
// Fill in the two values below from your Supabase project's
//   Project Settings → API page.
// All three HTML pages (intake, offer, dashboard) load this file.
// ============================================================

window.DANDELION_CONFIG = {
  // ↓↓↓ FILL THESE IN ↓↓↓
  SUPABASE_URL: 'https://acmjbeatbwetjmkibfvm.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjbWpiZWF0YndldGpta2liZnZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMTM3OTgsImV4cCI6MjA5NDc4OTc5OH0.9Du9L2i_Ku3m2cW0_Md8mZutfDpMC-5HYnY1TV0FUCU',
  // ↑↑↑ FILL THESE IN ↑↑↑

  // Public base URL the customer offer page lives at.
  // Used when copy-pasting offer emails. Trailing slash optional.
  // Example: 'https://dandelion-kids.vercel.app'
  PUBLIC_BASE_URL: window.location.origin
};
