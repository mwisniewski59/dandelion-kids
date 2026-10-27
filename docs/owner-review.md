# BST Flow for Dandelion Kids: how it works and what we need from you

*An owner's guide. Please read it before the pilot week. Anything marked **(to confirm)** is something we couldn't settle from the app itself, so we'll check it with you rather than guess.*

---

## (a) BST Flow on one page

BST Flow is the shop's buy/sell back office, built around the way you already work. It does the same job as **the Google Form** customers fill in at drop-off plus **the Sellers' Sheet 2026** where the team tracks every bag. The difference is that it all lives in one place, and the customer's side is part of it too.

- **Customers** still scan a QR code or tap a link to fill in a short drop-off form. The form walks them through the drop-off policy, they tick that they agree, and they pick a standard bag (25 items or fewer) or a bulk bag (26 or more).
- **Staff** see every bag on a **board** with one column per step: New Drop-Offs → Tagging → Pricing → Awaiting Reply → Ready to Pay → Awaiting Pickup → Resolved. Clicking a bag opens its page, where staff tag it, price it with the pricing tool, and send the offer. If you prefer rows and columns, a **Spreadsheet** view shows the same bags.
- **The offer** goes to the customer by email, either sent straight from the app or copied into Gmail. The email has a personal link to a simple page. There the customer picks **cash by Venmo** or **store credit**, and what should happen to anything you didn't buy (**pick up** or **donate**). Their answer lands back on the board on its own, so nobody has to retype it from an email.
- **The rest of the app:** **Insights** gives you charts (drop-offs per week, cash vs credit, money paid out). **Customers** gives you everyone's history. **Pricing**, **Rules** and **Settings** hold your price list, the brands you don't buy, and your percentages.

**What it replaces:** the Google Form, and the hand-kept columns in the Sellers' Sheet: T, P, Email Sent, Venmo Amount, Store Credit Amount, Venmo or Credit, Pick Up or Donate, and notes. In BST Flow each of those is a button press or the customer's own choice, stamped with the date and the staff member who did it.

---

## (b) The flow, step by step

**1. The customer drops off.** They scan the QR code or open the shop's link (it looks like `bstflow.com/intake.html?shop=…`) and go through 8 short screens:
- a welcome
- the standard policy
- the bulk policy
- two "I agree" boxes
- name, email and phone
- standard or bulk
- "donate all unsold items?" (yes, or "no, I'd like to see my offer first"; bulk bags are always donated)
- an optional bag description

They get a thank-you screen that says to expect an email in 1–3 business days. The bag appears in **New Drop-Offs**.

**2. Staff tag the bag.** Open the bag, click **Start Tagging**, then **Finish Tagging** when it's done. The app asks how many items were kept. This replaces the **T** column.

**3. Staff price the bag.** For standard bags, the pricing tool asks for brand, item type and size, then suggests the resale price from your price list. Staff can nudge the price up or down, pick "Custom Price", and so on. A brand on your do-not-buy list can't be added. The tool keeps a running total and shows the **cash offer (30% of resale)** and the **store credit offer (40% of resale)**. For bulk bags, staff enter two counts instead: regular items at **$0.50** and onesies or baby pants at **$0.25**. For bulk, the cash and credit amounts are the same. This replaces the **P** column.

**4. The offer goes out.** **Finish Pricing & Prepare Offer** opens a review screen with every item and the totals. From there, **Send Offer Email** shows the ready-made email, and staff have two choices:
- **Send Email Now:** the app emails the customer from **offers@bstflow.com** under the shop's name, and replies go to the staff member who sent it.
- **Open in Gmail:** the app copies the email (with a clickable link) and opens a Gmail draft addressed to the customer. Staff paste it, send it from the shop's Gmail, then click **Mark Sent Manually**.

Either way the bag moves to **Awaiting Reply**. Once a bag leaves Pricing, its item list is locked, so the record always matches what the customer was offered. This replaces the **Email Sent** column.

**5. The customer answers.** The link opens their offer page, where they choose store credit or cash by Venmo. If they choose cash, they must type their Venmo handle. They also choose pickup or donate, unless they already said "donate everything" on the form or it's a bulk bag. They can answer once. After that, the page shows the choice they made and asks them to contact the shop to change it. On the board the bag moves to **Ready to Pay** with a colored tag showing their choice. The board doesn't update live, so staff need to press **Refresh** (or reload) to see new drop-offs and new answers.

**6. Staff pay out and mark it paid.** For cash, staff send the Venmo payment *outside* the app first, then click **Mark Paid**. For store credit, staff record the credit wherever the shop keeps credit today, then click **Mark Paid**. (The training guide calls this "the credit log". Where that lives, and whether it's your point-of-sale, is **to confirm**.) BST Flow records who paid and when, but it doesn't move any money or create credit in your till.

**7. Leftovers.** If the customer chose donate, Mark Paid finishes the bag and it goes to **Resolved**. If they chose pickup, it goes to **Awaiting Pickup**. When they come in, staff click **Customer Picked Up**. If they don't come, staff click **Donate Leftovers (No-Show)**. The customer email and offer page both say unclaimed items are donated after 7 days.

**What triggers reminders and auto-donation, honestly:** Settings has **Reminder Days (4)** and **Auto-Donate After (7 days)**, but in the current code **nothing happens automatically**. No reminder email goes out, and no bag is donated by itself. Instead:
- Cards waiting on a reply change color by how long since the offer went out: yellow at 2 days, orange at 4, red at 6. Staff can then click **Resend Offer Email**.
- Cards in Awaiting Pickup change color the same way, counting from when the bag was paid. **Insights** counts pickups that are "stale (7+ days)". Staff then donate them with one click.
- Whether anything runs behind the scenes in the database is **to confirm**. If you want automatic reminders or automatic donation, that's a new feature, listed in the decisions below.

**Two shortcuts:**
- **Walk-In Drop-Off** records a customer you handled start to finish at the counter.
- **Manual Resolution** records an answer that came by phone, in person or by email reply, or applies a default when someone never replies.

---

## (c) Who does what

Everyone signs in with their own email and password. There's no shared admin password; what you can do depends on your role. Staff accounts are added by hand. Customers never need an account, and there's no public sign-up.

| | **Owner** (you) | **Manager** | **Staff / associate** |
|---|---|---|---|
| Board, Spreadsheet, drop-off pages | Yes | Yes | Yes |
| Tag, price, send offers, Mark Paid, pickups/donations | Yes | Yes | Yes |
| Walk-In, Manual Resolution, Reopen, Delete a drop-off, Export to Excel/CSV | Yes | Yes | Yes *(today; see decisions)* |
| Insights (money paid out, charts) | Yes | Yes | Yes *(today)* |
| Customers (names, emails, phones, history) | Yes | Yes | Yes |
| **Pricing** (brands, price list) | View & change | View & change | Tab hidden |
| **Rules** (do-not-buy brands, special pricing) | View & change | View & change | Tab hidden |
| **Settings** (percentages, bulk prices, timing, history importer) | View & change | View & change | Tab hidden |
| Add/remove logins, change roles | Done for you by hand in the database (see runbook) | | |

The app hides Pricing, Rules and Settings from staff, and the code says the database also refuses staff edits (**to confirm** on the live database). Deleting a drop-off is a "soft" delete: there's an Undo, and the record is kept.

---

## (d) What customers see

- **The drop-off form.** A clean, phone-friendly form with the Dandelion Kids name at the top and "Powered by BST Flow" in small print at the bottom. It explains:
  - **Standard (25 or fewer):** you decide what to buy and the price, there's no itemized list, and leftovers can be picked up within 7 days or donated.
  - **Bulk (26 or more):** $0.50 per item and $0.25 per onesie or baby pants, and all leftovers are donated.
  - Store credit expires after one year.

  They tick "I understand the policy" and "I consent to sell all items in this bag", give their contact details, choose their bag type and leftover preference, and get a confirmation with a short drop-off ID. It takes about 90 seconds.
- **The offer email.** Subject: *"Your Dandelion Kids Clothing Drop!"* It's warm and personal. It thanks them, offers "$X in store credit or $Y via Venmo", explains the leftovers (or confirms they'll be donated, if that's what they chose), and has a big **Choose Your Payment Option** button. It's signed "The Dandelion Kids Team". (This describes the copy-into-Gmail version. The direct-send version is built by the server and should match; **to confirm**.)
- **The offer page.** It greets them by first name and shows their bag. **Store Credit** is listed first and highlighted with a "bonus" badge; at 30% cash and 40% credit, it reads **+33% bonus**. Next to it is **Cash via Venmo** ("We'll Venmo you within a few days"), which needs their Venmo handle. Then comes the leftovers question (donate, or pick up within 7 days), then **Submit My Choice**, then "Thanks! We'll be in touch soon."

---

## (e) What changes day to day, and what stays the same

**What changes for staff:**
- No more typing T / P / amounts / "Email Sent" / Venmo-or-Credit / Pick-up-or-Donate into the sheet. Each one is a button, and the customer fills in their own choices.
- Offer amounts are worked out from the price list and your percentages, so nobody does the maths by hand.
- The offer email writes itself. Staff send it with one click or one paste.
- Finding a bag means searching by name, email or bag description on the board, instead of scrolling the sheet.
- The board's colors show what's going stale, instead of someone noticing.
- One habit to build: **press Refresh** to see new drop-offs and customer replies.

**What stays the same:**
- The customer still scans a code and fills in a form, with the same policy wording, prices and 7-day leftover window.
- Staff still tag, price, and decide what to buy.
- Cash still goes out by Venmo from the shop's account, and store credit is still recorded where you record it now.
- Leftovers are still picked up or donated to your local partners.
- Bag descriptions and notes still work, and you can still export to a spreadsheet whenever you like.

**One detail to know:** the policy wording on the form and in the email ($0.50 / $0.25, 7 days, one-year credit) is written into the pages. It is **not** read from Settings. If you change bulk prices or the timing, tell us and we'll update the wording too. The cash and credit percentages *are* read from Settings automatically.

---

## (f) Decisions for you

| Decision | Today in BST Flow | Options |
|---|---|---|
| **Who sets and changes prices** (price list, brands, special pricing) | Owner and managers; staff can't see those tabs | Keep as is · owner only (make managers staff) · let staff edit too |
| **Cash and credit percentages** | Cash 30% of resale, credit 40% (shows as "+33% bonus") | Keep · change in Settings anytime (offers already sent keep their amounts) |
| **Who sends offers** | Any signed-in person, any role, with no approval step | Keep · owner/manager must review first (a new feature; could start as a house rule) |
| **How cash is paid** | Venmo only; customers must give a handle | Keep Venmo only · also allow "cash in store" (a new option on the offer page; **to confirm** if wanted) |
| **Reminder timing** | Setting says 4 days, but nothing is sent automatically; cards change color and staff resend by hand | Keep manual · automatic reminder email after N days (new feature) |
| **Donation timing** | Customers are told 7 days; staff click "Donate Leftovers" when a pickup goes stale | Keep manual · automatic donation after N days (new feature) · different number of days |
| **Bulk pricing** | $0.50 per item, $0.25 per onesie or baby pants; bulk = 26+ items; all leftovers donated | Keep · new prices or threshold (we update the form wording too) |
| **Brands you don't buy** | A "DO NOT BUY" list under Rules; those brands can't be added during pricing | Review the list together during the pilot · add any missing brands |
| **Who gets a login and what role** | Added by hand; roles are owner / manager / staff | Send us the list: name, email, role |
| **Staff access to Insights, customer exports, delete** | All roles can see Insights, export CSV/Excel, and delete (with Undo) | Keep · limit some of these to owner/manager (small change) |
| **Import the sheet's history since May 26** (about 1,770 drop-offs) | Jan 2 – May 25 is already in BST Flow | **Mark has said yes.** We test it on a practice copy first, then import. Please confirm you're happy. |

**Questions about the Sellers' Sheet**, so the import maps your columns correctly:
1. What exactly do **T** and **P** mean? Our reading is "Tagged" and "Priced": a mark means that step is done. Is a T or P ever something else, such as a staff initial, a date or a count?
2. Are there rows that should **stay out** of the import, such as test rows, duplicates, cancelled or returned bags, walk-ins already recorded another way, or anything marked a particular way?
3. When "Venmo or Credit" or "Pick Up or Donate" is blank on an old row, should we treat it as **never replied** or as **unknown**?
4. For old rows marked paid, can we assume they're **finished**, or are any still waiting for pickup?

---

## (g) What happens next

1. **Set-up (before the pilot).** You send us the staff list and roles, plus answers to the questions above. We create the logins, and everyone tries the staff training guide (`bstflow.com/training.html`) on their phone.
2. **Practice run.** We run the sheet import on a practice copy with fake data first. You look it over to check the numbers look right, then we import for real.
3. **Pilot week, alongside the form.** For one week, new drop-offs come through BST Flow's QR code. Keep the Google Form and Sheet available as a safety net. Staff work the board, send offers, and mark bags paid. We check in daily and fix anything that gets in the way.
4. **Switch.** If the week goes well, we retire the Google Form, put up the BST Flow QR code for good, and stop adding rows to the sheet. The sheet stays as a read-only record.
5. **After the switch.** We look at the extras you chose above, such as automatic reminders, a cash-in-store option or approval before sending. We also suggest moving the database to a paid plan with daily backups before the form is turned off.

Thank you. The aim is that your team spends less time on the sheet and more time with customers and clothes. Anything here that doesn't match how the shop really works is exactly what we want to hear about.

---

### To confirm (summary)
- Whether anything automatic runs for reminders or donation behind the scenes. In the app's code, both are manual.
- Where store credit is recorded (the "credit log" or point-of-sale).
- That the database itself blocks staff from changing pricing and settings, not just hides the tabs.
- That the email sent directly from offers@bstflow.com matches the Gmail version's wording.
- The meaning of T and P, and which sheet rows to exclude.
- Whether you want cash-in-store as a payment option.
