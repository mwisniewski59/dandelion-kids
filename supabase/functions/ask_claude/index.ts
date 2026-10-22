// ============================================================
// ask_claude/index.ts
// ============================================================
// Supabase Edge Function that answers business questions about
// Lightspeed sales data using the Anthropic API.
//
// FLOW
//   1. Frontend POSTs { question: string } with the signed-in
//      staff member's session token in the Authorization header
//   2. We confirm the caller is a signed-in member of the
//      Dandelion Kids shop (the public anon key is NOT enough)
//   3. We run ~8 canned SQL queries against ls_* views to build
//      a structured JSON context bundle
//   4. We send (question + context) to Claude with a system prompt
//   5. Claude has a `run_sql` tool for follow-up SELECTs
//   6. We return Claude's final text answer + any SQL it ran
//
// SECRETS NEEDED
//   ANTHROPIC_API_KEY — from console.anthropic.com
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY — auto-injected
// ============================================================

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// The only shop whose Lightspeed data lives in the ls_* tables.
const DANDELION_TENANT_ID = "95ba216b-2f0a-470b-accd-c4b8c08b333e";

const MODEL = "claude-sonnet-4-6"; // balanced default; cheap enough for chat
const MAX_TOKENS = 1500;
const MAX_TOOL_ROUNDS = 4; // cap on agent loop iterations

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ─────────────────────────────────────────────────────────────
// AUTH GATE
// The platform's verify_jwt check accepts the public anon key, so
// it is not enough on its own. Require a real signed-in user who is
// a member of the Dandelion Kids shop.
// ─────────────────────────────────────────────────────────────
async function requireShopMember(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;

  const { data: membership } = await sb
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .eq("tenant_id", DANDELION_TENANT_ID)
    .maybeSingle();
  return membership ? user.id : null;
}

// ─────────────────────────────────────────────────────────────
// CONTEXT BUILDER
// ─────────────────────────────────────────────────────────────
async function buildContext() {
  const queries: Record<string, string> = {
    totals: `
      select
        sum(case when sale_date::date = current_date then total_payment end) as today_revenue,
        sum(case when sale_date::date = current_date then 1 end) as today_txn,
        sum(case when sale_date >= date_trunc('week', current_date) then total_payment end) as wtd_revenue,
        sum(case when sale_date >= date_trunc('week', current_date) then 1 end) as wtd_txn,
        sum(case when sale_date >= date_trunc('month', current_date) then total_payment end) as mtd_revenue,
        sum(case when sale_date >= date_trunc('month', current_date) then 1 end) as mtd_txn,
        sum(case when sale_date >= date_trunc('year', current_date) then total_payment end) as ytd_revenue,
        sum(case when sale_date >= date_trunc('year', current_date) then 1 end) as ytd_txn
      from ls_sales_enriched
    `,

    used_vs_new: `
      select
        sum(used_item_revenue) as used_revenue,
        sum(new_item_revenue) as new_revenue,
        sum(used_item_count) as used_units,
        sum(new_item_count) as new_units,
        sum(total_margin) as new_margin
      from ls_sales_enriched
      where sale_date >= current_date - interval '30 days'
    `,

    daily_trend: `
      select
        sale_day::date as day,
        sum(total_payment) as revenue,
        count(*) as transactions,
        sum(used_item_count) as used_units,
        sum(new_item_count) as new_units
      from ls_sales_enriched
      where sale_date >= current_date - interval '30 days'
      group by sale_day
      order by sale_day
    `,

    hour_of_day: `
      select
        hour_of_day::int as hour,
        count(*) as transactions,
        sum(total_payment) as revenue
      from ls_sales_enriched
      where sale_date >= current_date - interval '30 days'
      group by hour_of_day
      order by hour_of_day
    `,

    day_of_week: `
      select
        day_of_week::int as dow,
        count(*) as transactions,
        sum(total_payment) as revenue
      from ls_sales_enriched
      where sale_date >= current_date - interval '90 days'
      group by day_of_week
      order by day_of_week
    `,

    top_new_products: `
      select
        product_name, product_sku, brand_name, product_type_name,
        sum(quantity) as units_sold,
        sum(line_total) as revenue,
        sum(margin) as margin
      from ls_lines_enriched
      where is_used = false
        and sold_at >= current_date - interval '30 days'
      group by product_id, product_name, product_sku, brand_name, product_type_name
      order by revenue desc nulls last
      limit 15
    `,

    used_type_mix: `
      select
        coalesce(product_type_name, product_name, 'Unspecified') as type_name,
        sum(quantity) as units_sold,
        sum(line_total) as revenue,
        avg(price) as avg_price
      from ls_lines_enriched
      where is_used = true
        and sold_at >= current_date - interval '30 days'
      group by type_name
      order by revenue desc
      limit 20
    `,

    yoy: `
      with this_week as (
        select sum(total_payment) as rev, count(*) as txn
        from ls_sales_enriched
        where sale_date >= date_trunc('week', current_date)
          and sale_date < date_trunc('week', current_date) + interval '7 days'
      ),
      last_year as (
        select sum(total_payment) as rev, count(*) as txn
        from ls_sales_enriched
        where sale_date >= date_trunc('week', current_date) - interval '1 year'
          and sale_date < date_trunc('week', current_date) - interval '1 year' + interval '7 days'
      )
      select
        (select rev from this_week) as this_week_rev,
        (select txn from this_week) as this_week_txn,
        (select rev from last_year) as last_year_rev,
        (select txn from last_year) as last_year_txn
    `,

    slow_movers: `
      select
        p.name, p.sku, b.name as brand, pt.name as product_type,
        coalesce(sum(il.inventory_level), 0) as on_hand,
        p.retail_price,
        p.supply_price,
        p.created_at_ls::date as listed_on
      from ls_products p
      left join ls_brands b on b.id = p.brand_id
      left join ls_product_types pt on pt.id = p.product_type_id
      left join ls_inventory_levels il on il.product_id = p.id
      where p.deleted_at is null
        and p.is_active = true
        and p.is_used_sku = false
        and not exists (
          select 1 from ls_sale_line_items li
          where li.product_id = p.id
            and li.sold_at >= current_date - interval '60 days'
        )
      group by p.id, p.name, p.sku, b.name, pt.name, p.retail_price, p.supply_price, p.created_at_ls
      having coalesce(sum(il.inventory_level), 0) > 0
      order by on_hand desc
      limit 15
    `,

    sync_state: `
      select last_sync_at, last_sync_status, total_sales_synced,
             last_sale_version
      from ls_sync_state where id = 1
    `,
  };

  const results: Record<string, any> = {};
  await Promise.all(
    Object.entries(queries).map(async ([name, sql]) => {
      const { data, error } = await sb.rpc("run_sql", { query_text: sql });
      if (error) {
        results[name] = { error: error.message };
      } else {
        results[name] = data;
      }
    }),
  );

  return results;
}

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────
function systemPrompt(context: any) {
  return `You are a sales analyst for Dandelion Kids, a children's secondhand clothing resale shop in Dormont, PA owned by Colleen Wisniewski. Mark (her husband) built this dashboard and you're helping him and Colleen understand the business.

THE SHOP
- Sells two kinds of inventory side-by-side:
  1. NEW: SKU'd items with a cost on file (for COGS / margin math)
  2. USED: customer consignment items rung up under generic SKUs
     ("Used Top", "Used Pants" etc.) with NO cost recorded
- The flag is_used on line items = (cost IS NULL OR cost = 0)
- For USED items you only know: quantity, sale price, and item type
  (no brand, no size, no consignor link)
- For NEW items you know everything: brand, type, category, cost, margin

WHAT DATA YOU HAVE
You have a structured snapshot already (below) covering today/WTD/MTD/YTD
totals, used-vs-new split, daily trend, hour-of-day, day-of-week, top new
products, used type mix, YoY same-week, slow-moving new inventory, and
sync freshness.

If a question needs more detail, you can call the run_sql tool. The
schema available to that tool:

  -- VIEW: ls_sales_enriched (one row per closed sale)
  -- Columns: id, sale_date, status, state, attributes (text[]),
  -- total_price, total_tax, total_payment,
  -- line_item_count, used_item_count, new_item_count,
  -- used_item_revenue, new_item_revenue, total_margin,
  -- outlet_name, register_name, cashier_name, customer_id,
  -- hour_of_day, day_of_week, sale_day, sale_week, sale_month

  -- VIEW: ls_lines_enriched (one row per item sold)
  -- Columns: id, sale_id, quantity, price, cost, line_total,
  -- discount, is_used, sold_at, product_name, product_sku,
  -- brand_name, product_type_name, category_name, margin,
  -- sold_day, sold_week, sold_month

  -- TABLE: ls_products (catalog)
  -- Columns: id, name, sku, brand_id, product_type_id, category_id,
  -- supply_price, retail_price, is_active, is_used_sku, deleted_at

  -- TABLE: ls_inventory_levels (on-hand by outlet)
  -- Columns: product_id, outlet_id, inventory_level, average_cost

  Sale dates are timezone-aware. Use sale_date for filtering, not sold_at.
  Day-of-week: 0=Sun, 1=Mon, ..., 6=Sat. Hour: 0-23 local.

RULES FOR ANSWERS
- Be specific and concrete. Cite numbers from the data.
- Highlight what's notable. Don't just describe — interpret.
- When comparing periods, name both periods and the delta.
- For used inventory, remember the limits: you cannot speak to brand,
  size, or consignor. Don't make those up.
- Format dollar amounts as $1,234.56. Format percentages with one decimal.
- If the data doesn't answer the question, say so. Don't invent.
- Keep answers tight — 2-4 short paragraphs is the sweet spot unless
  the user explicitly asks for a deep dive.
- Don't show SQL in the answer unless the user asks. Just answer.

CURRENT DATA SNAPSHOT (run at ${new Date().toISOString()}):
${JSON.stringify(context, null, 2)}`;
}

// ─────────────────────────────────────────────────────────────
// TOOL DEFINITION
// ─────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: "run_sql",
    description:
      "Execute a read-only SELECT against the ls_* tables and views. Returns up to 500 rows as JSON. Use this when the canned context doesn't cover the question — e.g. for a specific product, brand, date range, or aggregation not in the snapshot.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A single SELECT (or WITH...SELECT) statement against the ls_* tables and views. The query is automatically limited to 500 rows.",
        },
        reason: {
          type: "string",
          description:
            "One sentence: what this query is checking and why.",
        },
      },
      required: ["query", "reason"],
    },
  },
];

// ─────────────────────────────────────────────────────────────
// ANTHROPIC API CALL
// ─────────────────────────────────────────────────────────────
async function callClaude(
  systemMsg: string,
  messages: any[],
): Promise<any> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemMsg,
      tools: TOOLS,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 500)}`);
  }
  return await res.json();
}

// ─────────────────────────────────────────────────────────────
// TOOL EXECUTOR
// The service-role client bypasses row-level security, so the
// model's ad-hoc queries are limited to the Lightspeed sales
// tables/views — never customers, drop-offs, staff or settings.
// ─────────────────────────────────────────────────────────────
const BLOCKED_TABLES =
  /\b(customers|dropoffs|activity_log|settings|pricing_config|memberships|invites|tenants|staff_profiles|ai_usage|ls_users|_migration_report)\b/i;

async function executeToolCall(name: string, input: any) {
  if (name === "run_sql") {
    const query = String(input?.query || "");
    if (BLOCKED_TABLES.test(query)) {
      return { error: "Only the Lightspeed sales tables (ls_*) can be queried." };
    }
    const { data, error } = await sb.rpc("run_sql", { query_text: query });
    if (error) {
      return { error: error.message };
    }
    return data;
  }
  return { error: `Unknown tool: ${name}` };
}

// ─────────────────────────────────────────────────────────────
// AGENT LOOP
// ─────────────────────────────────────────────────────────────
async function answerQuestion(question: string) {
  const context = await buildContext();
  const system = systemPrompt(context);
  const messages: any[] = [{ role: "user", content: question }];

  const toolCalls: any[] = [];
  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await callClaude(system, messages);
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b: any) => b.type === "tool_use",
    );
    const textBlocks = response.content.filter(
      (b: any) => b.type === "text",
    );

    if (response.stop_reason === "tool_use" && toolUses.length > 0) {
      const toolResults = await Promise.all(
        toolUses.map(async (tu: any) => {
          const result = await executeToolCall(tu.name, tu.input);
          toolCalls.push({
            name: tu.name,
            input: tu.input,
            result_preview: JSON.stringify(result).slice(0, 200),
          });
          return {
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(result),
          };
        }),
      );
      messages.push({ role: "user", content: toolResults });
    } else {
      finalText = textBlocks.map((b: any) => b.text).join("\n\n");
      return { answer: finalText, toolCalls, rounds: round + 1 };
    }
  }

  return {
    answer:
      finalText ||
      "I started analyzing but ran out of tool-use rounds. Try rephrasing or asking a more specific question.",
    toolCalls,
    rounds: MAX_TOOL_ROUNDS,
    warning: "Hit max tool-use rounds",
  };
}

// ─────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Use POST with { question: string }" }),
      { status: 405, headers },
    );
  }

  const userId = await requireShopMember(req);
  if (!userId) {
    return new Response(
      JSON.stringify({ error: "Please sign in with a Dandelion Kids staff account." }),
      { status: 401, headers },
    );
  }

  let body: { question?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers,
    });
  }

  const question = (body.question || "").trim();
  if (!question) {
    return new Response(
      JSON.stringify({ error: "Field 'question' is required" }),
      { status: 400, headers },
    );
  }
  if (question.length > 2000) {
    return new Response(
      JSON.stringify({ error: "Question too long (max 2000 chars)" }),
      { status: 400, headers },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await answerQuestion(question);
    return new Response(
      JSON.stringify({
        ok: true,
        answer: result.answer,
        toolCalls: result.toolCalls,
        rounds: result.rounds,
        tookMs: Date.now() - startedAt,
      }),
      { status: 200, headers },
    );
  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error("ask_claude error:", msg);
    return new Response(
      JSON.stringify({
        ok: false,
        error: msg,
        tookMs: Date.now() - startedAt,
      }),
      { status: 500, headers },
    );
  }
});
