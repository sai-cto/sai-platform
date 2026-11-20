# Phase 1 audit: hiredhandsmoving.com

I only read pages. Nothing was typed, clicked or submitted. I read all 16 pages linked from the nav and footer on the live site, and checked the homepage in the browser so content added by scripts was included.

Three findings change the plan:

- **The quote form isn't on Hired Hands' own site.** It's a Movegistics form shown inside the page in a frame, loaded from go.movegistics.com. I got every label and the field order from screenshots. I couldn't read the underlying input types or whether fields are required.
- **Two of the known issues aren't what they look like.** "Word on the Street" isn't empty in a browser. Its 13 real reviews load by script, though the page's raw HTML has only the heading. "Ready When You Are" is a small label above "Request A Move", not an empty section.
- **The site has two different "Terms" pages.** The moving contract (/pages/user_agreement, a link to a PDF) and the website terms (/pages/t-c) are separate documents.

## 1–2. Page inventory

### Site-wide

- Brand colors: navy `#1B3A6B` and yellow `#F5C518`. Navy text on yellow measures about 6.9:1 contrast, which passes. Navy on white measures about 11:1.
- Fonts: headings use Impact. Body text has no font set, so the browser falls back to Times.
- Header: logo (HiredHandsLogo.jpg), then the menus below, a "FREE QUOTE" button and a click-to-call link to (607) 524-3150.
  - Moving ▾ (Residential Move, Commercial Move, Packing Guide)
  - Additional Services ▾ (Labor, Junk Removal, Self Storage)
  - About
  - Hiring
  - Customer Support ▾ (Damage Claims, Feedback, Insurance, Hired Hands Moving Contract)
- Footer:
  - "Have a Question? We're Here To Help." with a "CONTACT US" button that goes to /free-quote
  - Phone (607) 524-3150, email hiredhands@studentagencies.com, address 409 College Ave, Ithaca, NY 14850
  - Instagram, Facebook and email icons (these do have labels)
  - Our Services: Residential Move, Commercial Move, Labor, Junk Removal, Self Storage, plus "Customer Service →", which goes to /free-quote
  - Hours: Monday–Friday "All Day", Saturday "All Day", Sunday "All Day"
  - Company: About Us, Hiring, Moving Safety (this goes to /packing-guide)
  - Bottom row: © 2026, Terms and Conditions, Privacy Policy, Feedback

### Home (/)

- H1: "Hired Hands Moving Company", with "Since 1984".
- Hero text: "AWARD WINNING MOVERS specializing in local, long-distance, and out-of-state moves serving Ithaca and the Greater Tompkins County Area". The button is labelled "Moving Made Easy" and goes to /free-quote.
- Service cards, each with a "Learn More" link:
  - Residential: "Professional movers. 5-star service…"
  - Commercial: "A care-free way to move your business…"
  - Labor: "Need hands but not the truck?…"
  - Junk Removal: "Professional garbage removal…"
  - Self Storage: "Secure, flexible storage…"
  - Hiring Now: "Join the Hired Hands team…", with an "Apply Now" button
- Why Us (a carousel of 4 cards, with one card repeated):
  - Flexibility, with "Move Today"
  - Professional Moving, with "About Us"
  - Competitive Pricing ("No frills and no day-of surprise price charges"), with "Request a Move"
  - Student-Run ("Run by Cornell Students…"), with "Learn More" going to /about
- Two photo captions with no context: "The Job" and "Loving'"
- Word on the Street: 13 five-star reviews in an auto-scrolling strip. Each review appears twice on the page.
- Request A Move: 3 steps
  - 01 Fill out the move request form or call
  - 02 Estimate within 12 hours
  - 03 Check out our Packing Guide
  - Buttons: "Move Request" and the phone number
- Stats: 40+ Years in Business, 4.5★ Customer Rating, 12hr Guaranteed Turnaround, 7 days We Work Weekends.
- Images:
  - upscale1shadow.jpg: a mover in a red shirt shaking hands with a customer at a front door (hero). Alt text is empty.
  - hiredhands-sai.jpg: Hired Hands logo next to "A division of Student Agencies Inc." Alt text is OK.
  - hiredhandsjohn2.jpg: a mover carrying a stack of boxes. Alt text is OK.
  - hiredhandsjohn1.jpg: a mover loading boxes onto a truck, with hills behind. Alt text is OK.
  - zeusJaredcrop.jpg: two movers and a customer shaking hands by a truck (background behind the reviews). Alt text is empty.

### Free Quote (/pages/free-quote)

- H1: "Contact Our Team" (the page title says "Free Quote").
- Text: "Request a quote or ask a question, we will get back to you as soon as possible."
- Form: the Movegistics frame described in section 3.

### Residential Move

- H1: "Residential Move", with "Moving Done Easy and Moving Done Right". CTA: "Get a Free Estimate".
- What You Get: 16' or 26' truck; at least two trained, background-checked movers; moving blankets; dollies; disassembly and reassembly included; free estimate, including on-site visual quotes.
- Images: puppy1.jpg (a puppy sitting on a moving box among stacked boxes; alt text says "Leadership", which is wrong); greatguysmovingawards.png (a Great Guys Moving "Unbiased Rankings" badge; alt text says "award").

### Commercial Move

- H1: "CommercialMove" (the space is missing).
- Intro: office relocations with minimal downtime. CTAs: Request a Quote and the phone number.
- Stats: 40+ Years Experience, 7 days Available Weekly, 12hr Estimate Turnaround.
- Built for Business: body text, with a "Get a Free Estimate" link.
- Six service cards: Office Relocation, Storage Solutions, Dedicated Crew, After Hours Moves, Insured (up to 60¢ per pound), Transparent Pricing.
- Four steps: Request a Quote (response within 12 hours), Plan the Move, Move Day, Settle In.
- Closing: "Ready to Move Your Business?" with Request a Quote and the phone number.
- Image: skyscraper1.png, looking up at tall buildings with a rental truck in front. Alt text says "Leadership", which is wrong.

### Packing Guide

- H1: "Packing Guide". The small label above it says "Moving Guide" and the footer link says "Moving Safety".
- Sections: General Packing Tips (7 tips), Bureaus & Dressers (do's and don'ts), Delicates: China & Crystal (do's and don'ts).
- CTAs: phone number and "Request a Quote". No images.

### Labor

- H1: "Labor", with "Hands when you need them…"
- Section: What We Cover. Response within 12 hours.
- CTAs: "Submit a Request" and the phone number. No images.

### Junk Removal

- H1: "Junk Removal", with "We haul it away. You move on."
- Section: What We Remove. Response within 12 hours.
- CTAs: "Submit a Request" and the phone number. No images.

### Self Storage

- H1: "Self Storage", with "Secure. Accessible. Simple."
- Content: partnership with Bolt Storage (24/7 video, gated entry, rent online in under 5 minutes). Hired Hands can deliver your items straight to your unit during a move.
- CTAs: "Find Your Nearest Unit Today" (goes to boltstorage.com) and the phone number.

### About

- H1: "Built in Ithaca.Built to Last." (the space is missing).
- More Than a Moving Company: a division of Student Agencies Inc. (SAI), helping since 1984
- Stats: 40+ Years Serving Ithaca, 4x Finger Lakes Award Winner, 4.5★ Customer Rating, SAI established 1894
- Meet the Team: Luke, Ewan and Kai (names only, no roles)
- Student Agencies Inc. section
- Award section: Cayuga Media Group, Best Moving Company in the Finger Lakes for 2022, 2023, 2025 and 2026
- CTA: "Request a Free Quote".
- Images: hiredhands-sai.jpg (the logo lockup); lukecrop2.jpg, ewan.jpg, kai.png (headshots; all three have alt text "Leadership" and should use each person's name); fingerlakesaward.jpg (the "Finger Lakes Favorites 2025 Winner" certificate; alt text is OK).

### Hiring

- H1: "Join the Team".
- Who We're Looking For: no experience needed, training provided, flexible schedule, competitive pay.
- Apply Now: "Submit an Application", which opens a Google Form.

### Damage Claims

- H1: "Damage Claims".
- Rule: claims must be submitted in writing to hiredhands@studentagencies.com within 72 hours of the end of the move.
- Four steps: Document the Damage, Submit Within 72 Hours, Include the Following (full name, move date, description, photos, estimated value), We Review & Respond.

### Feedback

- H1: "Feedback", with "Share Your Experience".
- CTAs: "Leave a Google Review" (Google Maps), the phone number, and "Contact Us" (goes to /free-quote).

### Insurance

- H1: "Insurance", with "Your belongings are in good hands."
- Our Coverage: full auto and workers' liability coverage; damaged items paid at up to 60¢ per pound; questions to the phone number or email.
- CTA: "Call Us".

### Contract (/pages/user_agreement)

- H1: "Hired Hands Moving Company Terms and Conditions".
- Content: only an "Open PDF In New Tab" link to a SharePoint PDF.

### Terms (/pages/t-c) and Privacy Policy

Both are full text, last updated June 2026, with contact details at the end. These are linked from the footer.

## 3. Free quote form fields

Read top to bottom from screenshots of the Movegistics frame.

| # | Label | Type (as it appears) | Options | Required now |
|---|---|---|---|---|
| 1 | Email Address | text field | — | Unknown |
| 2 | First Name | text field | — | Unknown |
| 3 | Last Name | text field | — | Unknown |
| 4 | Contact Number - Mobile | phone field | Country dropdown, defaults to US +1 | Unknown |
| 5 | Move Date | text or date field | — | Unknown |
| 6 | Origin Address Line 1 | text field | — | Unknown |
| 7 | Origin Zip Code | text field | — | Unknown |
| 8 | Destination Address Line 1 | text field | — | Unknown |
| 9 | Destination Zip Code | text field | — | Unknown |
| 10 | Referral Source | text field (no dropdown arrow visible) | — | Unknown |
| 11 | Customer Note | multi-line text box | — | Unknown |

Total: 11 fields. There are no selects, radio buttons or checkboxes. "Required now" is unknown because the frame can't be read from this site's page and no field shows an asterisk or "required" marker. The field labels sit inside the boxes as placeholder text and float up once a field has a value. The submit button says "SUBMIT".

## 4. UX Findings

| # | Problem | Principle | Fix |
|---|---|---|---|
| 1 | At least 13 different labels link to /free-quote (Free Quote, Moving Made Easy, Move Request, Get a Free Estimate, Request a Quote, Submit a Request, Request a Free Quote, Move Today, Request a Move, Contact Us, Customer Service →, and others) | Consistency, Hick's law | One label, "Get a Free Quote", used once in the header and once per page |
| 2 | Menu and footer names don't match: Customer Support vs "Customer Service →" (which goes to the quote form); Packing Guide vs "Moving Safety"; About vs "About Us"; "Hired Hands Moving Contract" vs a contract page titled "Terms and Conditions" | Consistency | One name per page, used everywhere |
| 3 | Footer repeats the nav (services, About, Hiring); Damage Claims and Insurance aren't in the footer | Visual hierarchy | Footer holds only contact, hours, and support/legal links |
| 4 | Hours show "All Day" for every day | Clarity, trust | Real hours, marked as a TODO for now |
| 5 | A leftover Shopify search popup with "No products found" sits hidden in every page, with no way to open it | Clean markup | Remove it |
| 6 | Reviews load only by script, so "Word on the Street" is empty without scripts | Robustness | Static HTML, or leave the section out |
| 7 | Reviews scroll on their own with no pause, and each one appears twice, so screen readers read 26 | WCAG 2.2.2 (pause, stop, hide), 1.3.1 | No auto-motion and no duplicates |
| 8 | Why Us hides 4 short points in a carousel, repeats one card, and has unexplained captions ("The Job", "Loving'") | Hick's law, visual hierarchy | A static grid of 4 points |
| 9 | Hiring card mixed in with the services | Visual hierarchy | Hiring gets its own nav item |
| 10 | Images with missing or wrong alt text: hero and review background have empty alt; puppy, skyscraper and headshots say "Leadership"; one badge says "award" | WCAG 1.1.1 | Descriptive alt on every image |
| 11 | Headings with missing spaces: "CommercialMove", "Ithaca.Built", "AwardWinner" | WCAG 1.3.1 | Real spaces in the text |
| 12 | Quote page H1 "Contact Our Team" doesn't match "Free Quote"; it says "as soon as possible" where every other page says 12 hours | Consistency | H1 "Get a Free Quote" and the 12-hour promise |
| 13 | The form frame has no title, a fixed 800px height with its own scrollbar, labels that are only placeholders, and no required markers | WCAG 4.1.2, 3.3.2; form usability | A native form on the page with visible labels |
| 14 | Body text falls back to Times; headings use Impact | Consistency | One font family |
| 15 | Yellow hero text over the photo ("AWARD WINNING MOVERS") may fail contrast | WCAG 1.4.3 | Text on a solid or darkened background |
| 16 | Small inconsistencies: "5-star service" vs a 4.5★ rating; page titles "tc –" and "user_agreement –" | Trust, consistency | Proper page titles; keep the copy as is and flag the claim |

## 5. Approved sitemap (5 top-level items)

- Services ▾: Residential Move, Commercial Move, Labor, Junk Removal, Self Storage
- Moving Help ▾: Packing Guide, Insurance, Damage Claims, Moving Contract
- About
- Careers (the Hiring page)
- Get a Free Quote (button), with the click-to-call number next to it

Footer: contact details, hours, and Damage Claims · Insurance · Feedback · Moving Contract · Terms · Privacy.

16 pages: index, free-quote, 5 service pages, packing-guide, about, hiring, damage-claims, insurance, feedback, contract, terms and privacy.

## Decisions taken for Phase 2

- **Phone country code:** kept as a required select (defaults to US +1) inside field 4. 11 fields, 12 controls.
- **Reviews:** left out. The review text isn't recorded in this audit, and the homepage order has no slot for it.
- **Where quotes go:** the form posts to `#` with a TODO until a destination is chosen. Nothing is sent anywhere.
- **Every field required**, as specced. This includes Customer Note and Referral Source, which may cost some submissions.
