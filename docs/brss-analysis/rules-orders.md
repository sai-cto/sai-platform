# BRSS business rules — orders, articles, storage, payments

Extracted from the Salesforce source in `brss-salesforce` (read-only). Scope: order processing, articles, storage, payments.

**Conventions**

- Every rule row is `ID | rule | citation`. Citations are `path/from/repo/root:line[-line][,line…]`; several line groups after one path all belong to that file.
- Rule IDs use three digits (`R-ORD-001`…) because there are more than 99; numbering restarts on a round number per section, so gaps are intentional. Open questions are `Q-ORD-nn` (section 10).
- A good part of the behaviour (article status, storage dates, e-mails, totals) is not in Apex but in flows, workflow rules and formula fields under the same `force-app/main/default/` tree. Those are included and cited, because without them the status progression and the storage dates cannot be explained.
- Nothing here is inferred from intent. Where the code is ambiguous, contradictory, dead, or depends on org data that is not in the repo, it is in section 10.
- No credentials, org IDs, people's names or e-mail addresses are reproduced. Recipients are described by role.

**Read first: what "order detail page" really is.** `BRSS_OrderDetails` is the *customer's* page (it only loads an order whose `Customer__c` is the logged-in user). There is no custom staff order page in the repo: staff use the standard Salesforce Order record plus the "Process Order" button. See R-ORD-150 and Q-ORD-01.

---

## 1. Order lifecycle

### 1.1 Types, record types, statuses, fields set automatically

| ID | Rule | Citation |
|---|---|---|
| R-ORD-001 | An order's kind is the multi-select field `Type__c`. Values: Packing, Ship to Cornell, Ship to Home, Storage, Supplies. One order can carry several values (stored `;`-separated), and every "is this a storage/shipping order" test is a contains-check on that list. | force-app/main/default/objects/Order/fields/Type__c.field-meta.xml:8-33; force-app/main/default/classes/BRSS_OrderDAO.cls:14-18; force-app/main/default/classes/BRSS_SObjectUtils.cls:10,16-26 |
| R-ORD-002 | Two Order record types exist, Default and Express ("Used for Express Order Creation"). None of the BRSS Apex classes reads the record type. | force-app/main/default/objects/Order/recordTypes/Default.recordType-meta.xml:3-5; force-app/main/default/objects/Order/recordTypes/Express.recordType-meta.xml:3-5 |
| R-ORD-003 | The code knows four order statuses: Open, Activated, Closed, Cancelled. | force-app/main/default/classes/BRSS_OrderDAO.cls:20-23 |
| R-ORD-004 | An order cannot be saved without a customer (`Customer__c`, a lookup to the user who owns the order). | force-app/main/default/objects/Order/validationRules/BRSS_CustomerExists.validationRule-meta.xml:4-8 |
| R-ORD-005 | Every order created by the customer wizards starts with Status = Open, EffectiveDate = today, and the standard price book. | force-app/main/default/classes/BRSS_OrderUtils.cls:38-46; force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:91-106,237-244 |
| R-ORD-006 | The order's account is the customer's own account; if the customer has none, the account named in setting `DefaultAccount__c` is used. | force-app/main/default/classes/BRSS_OrderUtils.cls:10-19 |
| R-ORD-007 | On every insert and update the order's owner is forced to equal its customer. | force-app/main/default/triggers/BRSS_OrderBgJobs.trigger:10-13; force-app/main/default/classes/BRSS_OrderUtils.cls:173-186 |
| R-ORD-008 | On insert, an order without a price book gets the standard price book. | force-app/main/default/triggers/BRSS_OrderBgJobs.trigger:19-22; force-app/main/default/classes/BRSS_OrderUtils.cls:144-170 |
| R-ORD-009 | The ship-home zone (`ShipHomeZone__c`) is derived from the first 3 digits of `ShipHomeZip__c` by range lookup in `ZipZone__c` (low ≤ code ≤ high). It is computed on insert when a zip is present and the zone is empty, and recomputed whenever the zip changes. A non-numeric zip is skipped. | force-app/main/default/triggers/BRSS_OrderBgJobs.trigger:28-35; force-app/main/default/classes/BRSS_OrderZipZoneUtils.cls:27-36,66-70,80-87,100-107; force-app/main/default/classes/BRSS_ZipZoneDAO.cls:10,24-27,33-41 |
| R-ORD-010 | The customer "complex order" wizard sets the types from the customer's choices: Storage and/or one shipping type (Ship to Home or Ship to Cornell), plus Packing if packing was selected. | force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:138-160 |
| R-ORD-011 | There are also single-purpose wizards that create a Packing-only order and a Supplies-only order. | force-app/main/default/classes/BRSS_CreatePackingOrderController.cls:60-73; force-app/main/default/classes/BRSS_CreateSupplyOrderController.cls:67-80 |
| R-ORD-012 | If the customer picks supplies inside the complex wizard, a second, separate order of type Supplies is created with its own Supplies appointment (same address as the main appointment, own date/time). | force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:193-231 |
| R-ORD-013 | `Prearrival__c` on the order is set to true automatically whenever an order item is created for a product flagged `Prearrival__c`. The complex wizard adds that product (setting `PrearrivalProductId__c`, quantity 1) when the customer selects pre-arrival. | force-app/main/default/flows/BRSS_Prearrival.flow-meta.xml:54-57,90,113-161; force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:166-179 |
| R-ORD-014 | Order total is a formula: sum of order item amounts + tax + tip − discount. Tax is a formula: (sum of order item amounts − discount) × tax percentage setting. Discount and tip default to 0. | force-app/main/default/objects/Order/fields/OrderTotal__c.field-meta.xml:5; force-app/main/default/objects/Order/fields/Tax__c.field-meta.xml:5; force-app/main/default/objects/Order/fields/DiscountAmount__c.field-meta.xml:4; force-app/main/default/objects/Order/fields/TipAmount__c.field-meta.xml:4 |
| R-ORD-015 | `NumArticles__c` on the order is a count of its order-article links. | force-app/main/default/objects/Order/fields/NumArticles__c.field-meta.xml:6-9 |
| R-ORD-016 | When an appointment is created for an order whose campus category is empty, the order is stamped On-Campus or Off-Campus from the appointment's region/building. | force-app/main/default/flows/Appointment_Trigger_After_Save.flow-meta.xml:187-206,238-256,264-266 |

### 1.2 Status transitions

| ID | From → To | Trigger and rule | Citation |
|---|---|---|---|
| R-ORD-017 | (new) → Open | Order created by any customer wizard. | force-app/main/default/classes/BRSS_OrderUtils.cls:43,48-57 |
| R-ORD-018 | Open → Cancelled | Customer presses "Cancel Order" on their order page. Allowed only when status is Open AND the earliest appointment either does not exist or is dated strictly after today. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:87-90,178-186; force-app/main/default/pages/BRSS_OrderDetails.page:52 |
| R-ORD-019 | (side effect of cancel) | Cancelling also sets every appointment of the order to Cancelled, in one all-or-nothing save. The method changes nothing else: no order items, articles, or payments are touched and no Stripe call is made. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:185-206; force-app/main/default/classes/BRSS_UT_CustomerOrderActions.cls:1432-1445 |
| R-ORD-020 | Open → Activated | No Apex, flow or workflow in the repo sets Activated. The code only reads it: Activated is treated the same as Open for Extend Storage, Deliver Stored Items and Ship Stored Items, but an Activated order can no longer be cancelled by the customer. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:85,89,93-120 |
| R-ORD-021 | any → Closed | No Apex, flow or workflow in the repo sets Closed. When it is set (by hand), every order-article link gets `Order_Status__c` = Closed, and that in turn sets every linked article's status to Delivered (R-ORD-077). Closed and Cancelled orders are hidden from the customer's "active" dashboard list. | force-app/main/default/flows/BRSS_Update_Order_Article_Status.flow-meta.xml:54-57,110-161; force-app/main/default/flows/BRSS_UpdateArticleStatusDelivered.flow-meta.xml:54-57,110-161; force-app/main/default/classes/BRSS_OrdersDashboardController.cls:98-101 |
| R-ORD-022 | (no change) | Crew order processing on the phone never changes the order status. The only order fields it writes are the price book (if blank) and, when a payment is taken, the cumulative discount and tip. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:87-90,145-159 |
| R-ORD-023 | sub-state | `StorageDeliveryScheduled__c` (default false) is set true when the customer schedules delivery from storage or ship-home from storage. Once true, Extend Storage, Deliver Stored Items and Ship Stored Items are all blocked. Nothing in the repo sets it back to false. | force-app/main/default/classes/BRSS_DeliverStoredArticlesCtrl.cls:70; force-app/main/default/classes/BRSS_ShipHomeStoredArticlesCtrl.cls:99; force-app/main/default/classes/BRSS_OrderDetailsController.cls:93-120; force-app/main/default/objects/Order/fields/StorageDeliveryScheduled__c.field-meta.xml:4 |
| R-ORD-024 | type change | Scheduling ship-home from storage appends "Ship to Home" to the order's types. | force-app/main/default/classes/BRSS_ShipHomeStoredArticlesCtrl.cls:100-101 |

---

## 2. Order items and products

### 2.1 Basics

| ID | Rule | Citation |
|---|---|---|
| R-ORD-025 | An order item is a standard OrderItem tied to a price book entry; its unit price starts as the price book entry's price. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:232-244 |
| R-ORD-026 | Order items have their own status: New (default) or Paid. "Unpaid" means status New or empty. | force-app/main/default/objects/OrderItem/fields/Status__c.field-meta.xml:13-18; force-app/main/default/classes/BRSS_OrderItemDAO.cls:10-11; force-app/main/default/classes/BRSS_OP_OrderItemsManager.cls:134-140 |
| R-ORD-027 | Items generated for an article always have quantity 1 and point at that article (`OrderItem.Article__c`). One article therefore produces several lines (storage, shipping, insurance…). | force-app/main/default/classes/BRSS_OrderItemUtils.cls:10-15,37-46 |
| R-ORD-028 | Line amount = unit price × quantity; a subtotal is the sum of line amounts. | force-app/main/default/classes/BRSS_PaymentUtils.cls:127-144 |
| R-ORD-029 | Product families defined: Storage, Packing, Supplies, Shipping, Pre-Arrival, Misc, Flat Rate Box. The code in scope filters by family only for Storage, Flat Rate Box, Supplies and Misc; all other products are found by product Id from settings. | force-app/main/default/classes/BRSS_ProductUtils.cls:10-16; force-app/main/default/classes/BRSS_OrderItemUtils.cls:63-64,72-73; force-app/main/default/classes/BRSS_PricebookEntryDAO.cls:60-62,75-76,89-90; force-app/main/default/classes/BRSS_OP_OrderItemsManager.cls:195-201 |
| R-ORD-030 | Only active price book entries of the order's price book are ever used; a product with no active entry silently produces no line. | force-app/main/default/classes/BRSS_PricebookEntryDAO.cls:23,38-52; force-app/main/default/classes/BRSS_OrderItemUtils.cls:29-35,138-143 |
| R-ORD-031 | Storage products for non-boxed items are Storage-family products flagged `NonBoxedItem__c`; they are the "subtype" list offered for a non-boxed article. | force-app/main/default/classes/BRSS_PricebookEntryDAO.cls:54-67,121-125; force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:132-141 |

### 2.2 Automatically generated lines (crew processing, extend storage, ship home)

| ID | Rule | Citation |
|---|---|---|
| R-ORD-032 | Which automatic lines are generated depends on the order's types: Storage → storage lines; Ship to Home → ship-home lines; Ship to Cornell → ship-to-Cornell lines; insurance lines are always considered. | force-app/main/default/classes/BRSS_OP_OrderItemsManager.cls:88-124 |
| R-ORD-033 | Storage, Standard Box: a box is "overweight" when its billable weight is ≥ 70 lb. The product is the storage-term product for the order's term, using the standard or the overweight variant. Unit price = price book price × billable weight (the price is per pound for the whole term, not per month). | force-app/main/default/classes/BRSS_OrderItemUtils.cls:293-305,317-329,54-59,447-457; force-app/main/default/classes/BRSS_SettingsUtils.cls:11,102-105; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:560-567 |
| R-ORD-034 | Storage-term product lookup: custom setting list `BRSS_StorageTermProduct__c` maps (term in months, overweight yes/no) → product Id. If no row has exactly the requested term, the row with the nearest shorter term is used; longer terms are never used. | force-app/main/default/classes/BRSS_SettingsUtils.cls:107-121,150-189,195-200 |
| R-ORD-035 | Storage, Non-boxed Item: the product is the article's own subtype product. Unit price = price book price × number of months (the price is per month). | force-app/main/default/classes/BRSS_OrderItemUtils.cls:60-67,78-121; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:558,568 |
| R-ORD-036 | Storage, Non-boxed "Other": when the article's product is the one named in setting `OtherNonBoxedProductId__c`, the monthly price is taken from the article's own `OtherStoragePrice__c` (entered by the crew) instead of the price book, then × months. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:97-115; force-app/main/default/classes/BRSS_UT_CustomerOrderActions.cls:1280-1281,1308-1310 |
| R-ORD-037 | Storage, Flat Rate Box: the product is the article's chosen flat-rate product (family Flat Rate Box, not flagged non-boxed). Unit price = price book price × number of months. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:69-76,113-116 |
| R-ORD-038 | An article whose type is neither Standard Box nor Flat Rate Box is priced as a non-boxed item. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:293-313 |
| R-ORD-039 | Ship to Home: only Standard Box articles get a line. Product = setting `ShipToHomeProductId__c`. Unit price = `ZoneWeight__c.ShipToHomePrice__c` for (order's ship-home zone, article's billable weight). If no zone or no matching zone/weight row exists, no line is created for that box (no error). | force-app/main/default/classes/BRSS_OrderItemUtils.cls:342-355,125-174; force-app/main/default/classes/BRSS_ZoneWeightDAO.cls:16-27,37-45; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:207-211 |
| R-ORD-040 | Ship to Cornell, box sent on the Cornell shipping account: two lines — a flat fee (product `FlatRateProductId_CornellShipping__c`, price book price) and a shipping line (product `ShipToCornellProductId__c`) priced from `ZoneWeight__c.ShipToCornellPrice__c` for (zone of the "received from" zip, billable weight); 0 if no row. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:357-403,473-498; force-app/main/default/classes/BRSS_ArticleWrapper.cls:52-64 |
| R-ORD-041 | Ship to Cornell, box sent on a third-party account: one flat-fee line (product `FlatRateProductId_OtherShipping__c`, price book price); weight and dimensions are irrelevant. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:373-392; force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:160-169,195-196 |
| R-ORD-042 | Ship to Cornell lines are only generated for Standard Box articles. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:373 |
| R-ORD-043 | Insurance: every article with additional insurance > 0 gets one line (product `InsuranceProductId__c`) priced at 10 % of the declared additional insurance value. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:405-428,461-470; force-app/main/default/classes/BRSS_SettingsUtils.cls:18; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:571-573 |
| R-ORD-044 | Additional insurance is chosen from a fixed list: $0 to $2,000 in $100 steps. | force-app/main/default/components/BRSS_SF1_OrderProcessing.component:281-303 |

### 2.3 Supplies and manual lines

| ID | Rule | Citation |
|---|---|---|
| R-ORD-045 | Supplies order form: one candidate line per active Supplies-family product; a line counts as "selected" when its quantity is > 0. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:269-276,181-199 |
| R-ORD-046 | A product literally named "* Supplies Delivery" is never chosen by the customer: it is added automatically with quantity 1 whenever at least one other supply line is selected, and omitted otherwise. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:183-204 |
| R-ORD-047 | During crew processing a crew member can add extra lines by picking any Misc-family or Supplies-family product, then editing description, unit price and quantity (quantity starts at 1). Both price and quantity must be > 0. | force-app/main/default/classes/BRSS_OP_OrderItemsManager.cls:185-249; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:664-698 |
| R-ORD-048 | Item status on creation: the pre-arrival line on a new complex order is New ("we do not charge a card"); lines of a Supplies order are Paid; lines created by Extend Storage and Ship Stored Items are Paid; lines written by crew processing are Paid when a payment step is used and New when "Complete without payment" is used. | force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:180-181,209-211; force-app/main/default/classes/BRSS_CreateSupplyOrderController.cls:98-100; force-app/main/default/classes/BRSS_ExtendStorageController.cls:84-86; force-app/main/default/classes/BRSS_ShipHomeStoredArticlesCtrl.cls:94-96; force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:136-140 |
| R-ORD-049 | A packing order is created with no order items at all. | force-app/main/default/classes/BRSS_CreatePackingOrderController.cls:79-85 |

### 2.4 Warehouse/location on order items

| ID | Rule | Citation |
|---|---|---|
| R-ORD-050 | Order items carry `Warehouse__c` (restricted picklist from a shared value set "Warehouses") and a free-text `Location__c`. | force-app/main/default/objects/OrderItem/fields/Warehouse__c.field-meta.xml:8-12; force-app/main/default/objects/OrderItem/fields/Location__c.field-meta.xml:6-9 |
| R-ORD-051 | Each order item is mirrored by one `Warehouse__c` record (auto-number W-0000) holding the same warehouse and location. Creating an order item, or changing its warehouse/location, creates or updates that record; editing the warehouse record's warehouse/location writes back to the order item. | force-app/main/default/flows/Order_Product_Sync_Warehouse_Location.flow-meta.xml:11-45,71-93,120-144,152-159; force-app/main/default/flows/Warehouse_Sync_Order_Product_Warehouse_Location.flow-meta.xml:27-43,51-57; force-app/main/default/objects/Warehouse__c/Warehouse__c.object-meta.xml:158-160 |

---

## 3. Articles

### 3.1 What an article is

| ID | Rule | Citation |
|---|---|---|
| R-ORD-052 | An article (`Article__c`) is one physical thing BRSS handles: a box or a loose item. It belongs to a customer (`Customer__c`, lookup to the user), not to an order, so the same article can appear on several orders over time. | force-app/main/default/objects/Article__c/fields/Customer__c.field-meta.xml:7-12; force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:115-124 |
| R-ORD-053 | Article number is an auto-number `A-000000`; this is the only identifier in the repo. Order-article links are `OA-0000`, payments `P-0000000`. | force-app/main/default/objects/Article__c/Article__c.object-meta.xml:158-162; force-app/main/default/objects/OrderArticle__c/OrderArticle__c.object-meta.xml:159-162; force-app/main/default/objects/Payment__c/Payment__c.object-meta.xml:157-160 |
| R-ORD-054 | Article types: Standard Box, Non-boxed Item (field default), Flat Rate Box. | force-app/main/default/objects/Article__c/fields/Type__c.field-meta.xml:13-24; force-app/main/default/classes/BRSS_ArticleDAO.cls:22-24 |
| R-ORD-055 | Article data: description, type, product (subtype for non-boxed, chosen box product for flat-rate), length/width/height (inches), weight (lb), billable weight (computed), additional insurance, other-storage-price, status, warehouse, section, row, pallet number. | force-app/main/default/classes/BRSS_ArticleDAO.cls:32-37; force-app/main/default/components/BRSS_SF1_StandardBox.component:32-49; force-app/main/default/objects/Article__c/fields/Pallet_Number__c.field-meta.xml:6-11 |
| R-ORD-056 | Billable weight stored on the article = the larger of actual weight and dimensional weight (L × W × H ÷ 139), rounded up to a whole pound. This stored value is what all pricing uses. | force-app/main/default/objects/Article__c/fields/BillableWeight__c.field-meta.xml:4-7; force-app/main/default/classes/BRSS_OrderItemUtils.cls:149,162,297,456; force-app/main/default/classes/BRSS_ArticleWrapper.cls:59-60 |
| R-ORD-057 | The phone screen and the server-side pre-check compute billable weight with a different divisor, 166 (see Q-ORD-03). | force-app/main/default/classes/BRSS_ArticleDAO.cls:14; force-app/main/default/classes/BRSS_ArticleUtils.cls:72-91; force-app/main/default/components/BRSS_SF1_StandardBox.component:69,93-94 |
| R-ORD-058 | An article can never be saved with stored billable weight above 150 lb. | force-app/main/default/objects/Article__c/validationRules/MaxBillableWeight.validationRule-meta.xml:4-7 |
| R-ORD-059 | An article's record owner is forced to be its customer. | force-app/main/default/flows/BRSS_ArticleOwnership.flow-meta.xml:42-52,100-148 |

### 3.2 How articles link to orders

| ID | Rule | Citation |
|---|---|---|
| R-ORD-060 | `OrderArticle__c` is the link between an order and an article (master-detail to both). It also stores two per-order facts: whether the Cornell shipping account was used, and the "received from" zip. | force-app/main/default/objects/OrderArticle__c/fields/Order__c.field-meta.xml:6-12; force-app/main/default/objects/OrderArticle__c/fields/Article__c.field-meta.xml:6-12; force-app/main/default/classes/BRSS_ArticleUtils.cls:93-112 |
| R-ORD-061 | Links are created only when crew processing is completed (with or without payment): one link per newly created article and per selected historical article. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:188-191; force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:425-432; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:710-713,950-953 |
| R-ORD-062 | An article already linked to the order cannot be linked again from the phone flow: already-linked articles are shown read-only as "Existing Order Articles" and are excluded from the historical-articles picker. | force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:102-109,116-124; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:246-258 |
| R-ORD-063 | Opening an order-article link in Salesforce redirects straight to the article record. | force-app/main/default/classes/BRSS_OrderArticleRedirectorExt.cls:25-42; force-app/main/default/pages/BRSS_OrderArticleRedirector.page:1; force-app/main/default/objects/OrderArticle__c/OrderArticle__c.object-meta.xml:129-134 |
| R-ORD-064 | The link carries two helper text fields used only to push statuses around: `Order_Status__c` and `Master_Article_Status__c` ("should not be updated manually"). | force-app/main/default/objects/OrderArticle__c/fields/Master_Article_Status__c.field-meta.xml:4-10; force-app/main/default/objects/OrderArticle__c/fields/Order_Status__c.field-meta.xml:6-9 |

### 3.3 Creating articles at intake (crew phone flow, step 1)

| ID | Rule | Citation |
|---|---|---|
| R-ORD-065 | A new article is created for the order's customer. If the order is a Ship to Cornell order, or is not a Storage order, the type is fixed to Standard Box and the type selector is hidden; only Storage (non-Cornell) orders let the crew choose between the three types. | force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:295-310; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:309-315 |
| R-ORD-066 | Standard Box: length, width, height and weight are required; the screen rounds each up to a whole number and shows dimensional and billable weight live. A "Large Box" shortcut fills 18 × 18 × 18. | force-app/main/default/components/BRSS_SF1_StandardBox.component:13,18-22,32-49,78-98 |
| R-ORD-067 | Standard Box weight check before saving: computed billable weight must be 1–150 lb, otherwise "Billable weight must be within 1-150 lbs range." The check is skipped for a Ship to Cornell box sent on a third-party account. | force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:38-39,194-205; force-app/main/default/classes/BRSS_SettingsUtils.cls:16; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:296-308 |
| R-ORD-068 | Non-boxed Item: a subtype (product) is required; if the subtype is the "Other" product a storage price must be entered. Dimensions and weight are forced to 0. | force-app/main/default/components/BRSS_SF1_OrderProcessing.component:317-333,414-424; force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:160-179 |
| R-ORD-069 | Flat Rate Box: the crew picks one flat-rate product (shown as "name - $price" with its description) and a quantity. Saving with quantity N creates N identical articles. Quantity cannot be changed when editing afterwards. Dimensions and weight are forced to 0. | force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:143-153,162-174,207-212; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:336-350 |
| R-ORD-070 | For a Standard Box the product link is cleared (boxes have no subtype). | force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:180-184 |
| R-ORD-071 | Ship to Cornell order: each box has a "Cornell Shipping Account" checkbox and a zip field. Ticked → dimensions/weight are required and the shipping price is looked up from the zip's zone. Unticked (third-party) → dimensions/weight are zeroed and the zip is discarded. | force-app/main/default/components/BRSS_SF1_OrderProcessing.component:430-436,448-457; force-app/main/default/components/BRSS_SF1_StandardBox.component:5-9; force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:160-169,239-248,349-358 |
| R-ORD-072 | Articles are written to the database the moment "Save" is pressed in the article editor, not when the order is completed. Deleting a new article from the list deletes it from the database. | force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:214-229,364-372 |
| R-ORD-073 | "Historical Articles": the crew can attach any existing article of the same customer that is not yet on this order (newest first), regardless of the article's status. The button only appears if such articles exist. | force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:115-130,385-413; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:179-181,484-512 |
| R-ORD-074 | A selected historical article cannot be edited, except on a Ship to Cornell order where a Standard Box can be "completed" with the Cornell-account flag and zip. | force-app/main/default/components/BRSS_SF1_OrderProcessing.component:229-233,264-269; force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:322-330,335-342 |

### 3.4 Article status progression

Status values (picklist, no default): **On Truck, to warehouse · In Warehouse · Stored · Ready for Delivery · On Truck, to delivery · Delivered · Ready for Shipment · Shipped**. The same eight values are offered on the order as "Master Article Status".

| ID | Rule | Citation |
|---|---|---|
| R-ORD-075 | The eight statuses above are the complete list; a new article has no status until something sets one. No Apex class ever writes an article's status. | force-app/main/default/objects/Article__c/fields/Status__c.field-meta.xml:13-52; force-app/main/default/objects/Order/fields/Master_Article_Status__c.field-meta.xml:13-48; force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:297-299 |
| R-ORD-076 | any → **Stored**: whenever an article is created or edited and any of pallet number, row, section or warehouse is filled in, its status is set to Stored. | force-app/main/default/workflows/Article__c.workflow-meta.xml:3-13,14-39 |
| R-ORD-077 | any → **Delivered**: when an order is Closed, every article linked to it becomes Delivered (order → link `Order_Status__c` = Closed → article). The second step fires on any create/edit of a link whose `Order_Status__c` is Closed. | force-app/main/default/flows/BRSS_Update_Order_Article_Status.flow-meta.xml:54-57,90,146-161; force-app/main/default/flows/BRSS_UpdateArticleStatusDelivered.flow-meta.xml:54-57,90,146-161 |
| R-ORD-078 | any → **any (bulk)**: staff set "Master Article Status" on the order; when that value changes it is copied to every order-article link, and from each link to its article. This is how all articles of an order are moved at once (e.g. to On Truck, In Warehouse, Ready for Delivery, Shipped). | force-app/main/default/flows/BRSS_MasterArticleStatus.flow-meta.xml:31-49,98,146-193; force-app/main/default/flows/BRSS_MasterArticleStatusStep2.flow-meta.xml:31-49,98,146-193 |
| R-ORD-079 | Every other change is a manual edit of the article's status field. There is no validation rule, flow or code that restricts which status may follow which. | force-app/main/default/objects/Article__c/validationRules/MaxBillableWeight.validationRule-meta.xml:1-8; force-app/main/default/objects/Article__c/fields/Status__c.field-meta.xml:6-9 |
| R-ORD-080 | The customer's order page shows each article's number, type, subtype, description and status under "Items Under Management". | force-app/main/default/pages/BRSS_OrderDetails.page:60-88 |

### 3.5 Warehouse and location

| ID | Rule | Citation |
|---|---|---|
| R-ORD-081 | Article location is four fields, all with field history: warehouse (Mecklenburg, Lansing), section (Boxes, Furniture, TV Room, Bike Room, Mattress Area, Chair, Lamp, Mirror, Fridge, Fan), row (A–N) and pallet number (up to 2 digits). | force-app/main/default/objects/Article__c/fields/Warehouse__c.field-meta.xml:7-19; force-app/main/default/objects/Article__c/fields/Section__c.field-meta.xml:7-59; force-app/main/default/objects/Article__c/fields/Row__c.field-meta.xml:7-79; force-app/main/default/objects/Article__c/fields/Pallet_Number__c.field-meta.xml:6-11 |
| R-ORD-082 | The order also has its own location hints: `Warehouse_Notes__c` (Mecklenburg, Lansing, Overflow, SAI Basement), free-text `Order_Location__c` ("Warehouse, Pallet Code") and `Large_Items__c`. No code reads or writes them. | force-app/main/default/objects/Order/fields/Warehouse_Notes__c.field-meta.xml:8-28; force-app/main/default/objects/Order/fields/Order_Location__c.field-meta.xml:4-10; force-app/main/default/objects/Order/fields/Large_Items__c.field-meta.xml:4-10 |
| R-ORD-083 | A third location mechanism exists per order item (R-ORD-050, R-ORD-051). | force-app/main/default/flows/Order_Product_Sync_Warehouse_Location.flow-meta.xml:71-93 |

---

## 4. Storage

### 4.1 Term and dates

| ID | Rule | Citation |
|---|---|---|
| R-ORD-084 | Storage term is a whole number of months on the order (`StorageTermInMonths__c`, max 2 digits). | force-app/main/default/objects/Order/fields/StorageTermInMonths__c.field-meta.xml:6-10 |
| R-ORD-085 | The storage-term picker offers exactly three choices, stored as 4, 6 and 8 months and labelled "3-4" (1 term, summer), "5-6" (1.5 terms, semester), "7-8" (2 terms, summer and semester). Shorter options are commented out. | force-app/main/default/components/BRSS_Form_StorageOptions.component:8-15,39-53 |
| R-ORD-086 | **Storage effective date, payment rule:** whenever a payment record of type Charge is created or edited on an order whose types include Storage, and the order's `Storage_Effective_Date__c` is still empty, it is set to that payment's creation date. It is never overwritten once set. | force-app/main/default/flows/BRSS_StorageEffectiveDatePayment.flow-meta.xml:54-58,85-89,97,121,156-204,230-235,238 |
| R-ORD-087 | Consequence of R-ORD-086: only a *captured* card charge starts the storage clock. The $-authorization taken when the customer books (type Authorize), a 0-Amount record (100 % discount) and "Complete without payment" do not. | force-app/main/default/classes/BRSS_PaymentUtils.cls:16-18,49,75; force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:256-258; force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:213-221,387-399 |
| R-ORD-088 | **Storage effective date, appointment rule:** whenever an appointment of type Pickup with status Completed is created or edited on an order whose types include Storage, and the effective date is still empty, it is set to the appointment's date. This automation is marked Active although its description says it is not used (Q-ORD-05). | force-app/main/default/flows/BRSS_StorageEffectiveDateAppointment.flow-meta.xml:54-58,85-89,116-120,128,152,187-235,261-266,269 |
| R-ORD-089 | Storage expiration date = effective date + term in months (calendar months). | force-app/main/default/objects/Order/fields/Storage_Expiration_Date__c.field-meta.xml:5 |
| R-ORD-090 | "Storage Delivery By" is a separate hand-written date formula from the same two inputs (effective date + term, day clamped to the month's last day). It is the latest date offered when the customer schedules delivery from storage, and the basis of "Days Until Delivery" = Delivery By − today. | force-app/main/default/objects/Order/fields/StorageDeliveryBy__c.field-meta.xml:5-24; force-app/main/default/objects/Order/fields/Days_Until_Delivery__c.field-meta.xml:5; force-app/main/default/pages/BRSS_OrderDetails.page:320 |
| R-ORD-091 | The customer dashboard shows the storage expiration date (R-ORD-089), while delivery scheduling and reminders use Delivery By (R-ORD-090). | force-app/main/default/classes/BRSS_OrdersDashboardController.cls:26; force-app/main/default/pages/BRSS_OrdersDashboard.page:57 |

### 4.2 Extend storage (customer)

| ID | Rule | Citation |
|---|---|---|
| R-ORD-092 | "Extend Storage" is offered when: delivery from storage is not yet scheduled, status is Open or Activated, the order's types include Storage, and the order has at least one article. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:85,93-98 |
| R-ORD-093 | The customer picks an additional term (4, 6 or 8 months). New storage lines are generated for **every** article on the order, priced exactly like fresh storage for the additional term alone (R-ORD-033 to R-ORD-037). | force-app/main/default/classes/BRSS_ExtendStorageController.cls:68-76,117-130; force-app/main/default/classes/BRSS_UT_CustomerOrderActions.cls:1300-1310 |
| R-ORD-094 | The customer pays immediately by card: total = new lines + tax, captured. The new lines are saved as Paid and the order's term is increased by the additional months (an empty term counts as 0). | force-app/main/default/classes/BRSS_ExtendStorageController.cls:82-103,105-115; force-app/main/default/pages/BRSS_OrderDetails.page:261-290 |
| R-ORD-095 | Extending does not touch the effective date; expiration and Delivery By move because they are formulas of the term. | force-app/main/default/classes/BRSS_ExtendStorageController.cls:91-97; force-app/main/default/objects/Order/fields/Storage_Expiration_Date__c.field-meta.xml:5 |
| R-ORD-096 | The extend form reuses the storage-options form, which also contains the "Pre-arrival delivery" checkbox bound directly to the order. | force-app/main/default/pages/BRSS_OrderDetails.page:231; force-app/main/default/components/BRSS_Form_StorageOptions.component:57-67 |

### 4.3 Deliver from storage (customer)

| ID | Rule | Citation |
|---|---|---|
| R-ORD-097 | "Deliver Stored Items" is offered when: the order is not a pre-arrival order, delivery is not yet scheduled, status is Open or Activated, types include Storage but not Ship to Home, and there is at least one article. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:100-108 |
| R-ORD-098 | The customer fills in a new appointment of type Delivery (status Unconfirmed), dated no later than Storage Delivery By. Saving creates the appointment and marks delivery as scheduled. | force-app/main/default/classes/BRSS_DeliverStoredArticlesCtrl.cls:19-21,65-79; force-app/main/default/classes/BRSS_AppointmentUtils.cls:42-50; force-app/main/default/pages/BRSS_OrderDetails.page:320-323 |
| R-ORD-099 | Delivery from storage costs nothing at scheduling time: no order items, no payment step, no Stripe call. | force-app/main/default/classes/BRSS_DeliverStoredArticlesCtrl.cls:15-16,71-73,81-85 |
| R-ORD-100 | Pre-arrival: the order page shows a pre-arrival notice instead of the delivery button; the customer-facing text promises complimentary drop-off to the on-campus room before the customer returns. | force-app/main/default/pages/BRSS_OrderDetails.page:46; force-app/main/default/components/BRSS_Form_StorageOptions.component:59-72 |

### 4.4 Ship home from storage (customer)

| ID | Rule | Citation |
|---|---|---|
| R-ORD-101 | "Ship Stored Items" is offered when: delivery is not yet scheduled, status is Open or Activated, the order has at least one Standard Box, and types include Storage but not Ship to Home. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:110-120 |
| R-ORD-102 | The customer enters address 1, state, city, zip, addressed-to (pre-filled with their name), phone and a ship date not earlier than today; address 2 is optional. | force-app/main/default/components/BRSS_Form_ShipHome.component:9,13,20,25,29,37,42-46,52; force-app/main/default/classes/BRSS_ShipHomeStoredArticlesCtrl.cls:58; force-app/main/default/pages/BRSS_OrderDetails.page:364 |
| R-ORD-103 | The zone is found from the zip, and one ship-home line is generated per Standard Box (R-ORD-039). Non-boxed items and flat-rate boxes get no line and no message. | force-app/main/default/classes/BRSS_ShipHomeStoredArticlesCtrl.cls:78-86,123-140; force-app/main/default/classes/BRSS_UT_CustomerOrderActions.cls:1337-1340 |
| R-ORD-104 | The customer pays immediately: total = lines + tax, captured. Lines are saved as Paid, delivery is marked scheduled and "Ship to Home" is added to the types. No appointment is created. | force-app/main/default/classes/BRSS_ShipHomeStoredArticlesCtrl.cls:92-109,111-121 |

### 4.5 Contract text shown to customers (payment terms)

| ID | Rule | Citation |
|---|---|---|
| R-ORD-105 | Storage: property insured for the lesser of $5,000 in aggregate or the stated value; damage valued at actual cash value. | force-app/main/default/components/BRSS_PaymentTerms.component:8-9 |
| R-ORD-106 | Storage: full payment is due at pickup or delivery to BRSS; $20 fee for a returned check. | force-app/main/default/components/BRSS_PaymentTerms.component:19 |
| R-ORD-107 | Abandonment: if the customer does not appear at the end of the agreed term, BRSS holds the property six months, then may dispose of it. | force-app/main/default/components/BRSS_PaymentTerms.component:23 |
| R-ORD-108 | Shipping: carrier liability is $100 per shipment unless a higher value is declared (extra charge); claims must be filed with BRSS within two weeks of delivery. | force-app/main/default/components/BRSS_PaymentTerms.component:32-34,39 |

---

## 5. Payments

### 5.1 When a card is charged, and how much

| ID | Rule | Citation |
|---|---|---|
| R-ORD-109 | Booking a storage/shipping (complex) order or a packing order does **not** charge the customer: it places an uncaptured authorization for the amount in setting `AuthorizationAmount__c` (field default 1), with no tax. | force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:251-258; force-app/main/default/classes/BRSS_CreatePackingOrderController.cls:92-97; force-app/main/default/classes/BRSS_AmountInfo.cls:105-109; force-app/main/default/objects/BRSS_HierarchySettings__c/fields/AuthorizationAmount__c.field-meta.xml:4-5; force-app/main/default/classes/BRSS_UT_CustomerOrderActions.cls:418,1172-1173 |
| R-ORD-110 | A Supplies order (stand-alone or the companion of a complex order) is charged in full and captured at booking: selected lines + tax. | force-app/main/default/classes/BRSS_CreateSupplyOrderController.cls:113-123; force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:262-271; force-app/main/default/classes/BRSS_SupplyEstimator.cls:10-15,33-38 |
| R-ORD-111 | The real charge for storage/shipping/insurance happens at crew processing: one captured charge for the processing total. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:289-300 |
| R-ORD-112 | Extend Storage and Ship Stored Items are captured charges at the moment the customer completes them. | force-app/main/default/classes/BRSS_ExtendStorageController.cls:105-109; force-app/main/default/classes/BRSS_ShipHomeStoredArticlesCtrl.cls:111-115 |
| R-ORD-113 | Amount formula: total = subtotal + tax + tip − discount. Tax = (subtotal − discount) × tax percentage setting ÷ 100. Tip is not taxed. Every figure is rounded half-up to 2 decimals. | force-app/main/default/classes/BRSS_AmountInfo.cls:54-60,84-99; force-app/main/default/classes/BRSS_SettingsUtils.cls:54-58; force-app/main/default/classes/BRSS_PaymentUtils.cls:122-125 |
| R-ORD-114 | Tax applies to the whole subtotal; no product (shipping, insurance, supplies…) is exempt. | force-app/main/default/classes/BRSS_AmountInfo.cls:89-95; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:644-646 |
| R-ORD-115 | Discount and tip exist only in crew processing; customer flows always have discount 0 and tip 0. | force-app/main/default/classes/BRSS_AmountInfo.cls:15-16,26-29; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:725-741 |
| R-ORD-116 | Discount cap: an admin (profile listed in setting `AdminPofilesIds__c`) may discount up to 100 % of the subtotal; anyone else up to the percentage in `MaxDiscountByNonAdmin__c` (field default 5). A larger entry is silently reduced to the cap. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:349-355; force-app/main/default/classes/BRSS_SettingsUtils.cls:79-95; force-app/main/default/classes/BRSS_AmountInfo.cls:61-71; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:925-931 |
| R-ORD-117 | A card payment requires a total > 0 ("Amount must be greater than 0"). There is no other minimum, deposit or card fee in code. | force-app/main/default/classes/BRSS_PaymentManager.cls:40,389-393 |
| R-ORD-118 | Zero total in crew processing (e.g. 100 % discount): Stripe is not called; a payment record of type "0-Amount" with amount 0 is written instead, and items are still marked Paid. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:213-221,312-317; force-app/main/default/classes/BRSS_PaymentUtils.cls:69-81; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:666-667,702-717 |
| R-ORD-119 | Each processing run adds its discount and tip to the order's running `DiscountAmount__c` and `TipAmount__c`. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:148-155; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:691-693 |

### 5.2 Card handling and Stripe calls

| ID | Rule | Citation |
|---|---|---|
| R-ORD-120 | Stripe is called server-to-server at `https://api.stripe.com/v1` with a secret key from settings, form-encoded bodies, 30-second timeout. Only HTTP 200 is success; otherwise Stripe's error message (or the HTTP status/exception text) is shown. | force-app/main/default/classes/BRSS_StripeRequest.cls:19-29,53-75,81-91; force-app/main/default/classes/BRSS_StripeResponse.cls:24,45-62; force-app/main/default/classes/BRSS_StripeRequestUtils.cls:64-72 |
| R-ORD-121 | Five Stripe operations are used: list a customer's cards, create a customer with a card, add a card to a customer, create a charge, refund a charge. There is no capture, void, webhook or payment-intent call. | force-app/main/default/classes/BRSS_StripeCardManager.cls:10-11,19-34,40-59; force-app/main/default/classes/BRSS_StripeCustomerManager.cls:10,16-33; force-app/main/default/classes/BRSS_StripeChargeManager.cls:10,16-33; force-app/main/default/classes/BRSS_StripeRefundManager.cls:10,18-38 |
| R-ORD-122 | Raw card number, CVC, name, expiry and billing address are typed into the BRSS form, posted to the Salesforce server and forwarded to Stripe from there. | force-app/main/default/components/BRSS_Form_Payment.component:33-59,84-93,103,121; force-app/main/default/classes/BRSS_StripeCard_In.cls:20-47; force-app/main/default/classes/BRSS_PaymentManager.cls:211-222,245-249 |
| R-ORD-123 | The Stripe customer id is stored on the user (`StripeId__c`). First card → create Stripe customer with that card; later new cards → added to the existing Stripe customer. The id is saved even if the charge that follows fails. | force-app/main/default/classes/BRSS_PaymentManager.cls:211-243,268-280,458-465; force-app/main/default/classes/BRSS_UserDAO.cls:12; force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:402 |
| R-ORD-124 | Saved cards are fetched live from Stripe each time the payment step opens and shown as "brand [****last4]"; selecting one fills the form read-only. The card last used on this order is preselected the first time. | force-app/main/default/classes/BRSS_PaymentManager.cls:108-119,320-347; force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:195-218; force-app/main/default/classes/BRSS_PaymentUtils.cls:95-107; force-app/main/default/components/BRSS_Form_Payment.component:12-17,214-229 |
| R-ORD-125 | New-card validation: number 13–16 digits (spaces ignored); CVC 3–4 digits; name required; month 1–12; expiry not before the current month (2-digit years are read as this century). | force-app/main/default/classes/BRSS_PaymentManager.cls:31-38,90-102,121-177 |
| R-ORD-126 | Customers must tick "I agree to payment terms" before any payment. In crew processing the terms are accepted automatically and the checkbox is hidden. | force-app/main/default/classes/BRSS_PaymentManager.cls:43-44,367-374; force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:94-95; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:832 |
| R-ORD-127 | A charge is sent with: amount in cents (rounded amount × 100), the running user's default currency, capture true/false, description "Charge. Order Id = …" or "Authorize. Order Id = …", the Stripe customer and the chosen card. | force-app/main/default/classes/BRSS_PaymentManager.cls:59-61,283-298,413-416; force-app/main/default/classes/BRSS_PaymentUtils.cls:13,115-118; force-app/main/default/classes/BRSS_StripeCharge_In.cls:10-13,19-36 |

### 5.3 Payment records

| ID | Rule | Citation |
|---|---|---|
| R-ORD-128 | Payment types: Charge (captured), Authorize (not captured), 0-Amount (no Stripe call). | force-app/main/default/objects/Payment__c/fields/Type__c.field-meta.xml:13-23; force-app/main/default/classes/BRSS_PaymentUtils.cls:16-18,49 |
| R-ORD-129 | A payment record is written only after Stripe confirms the charge. It stores: order, operation token, Stripe charge id, amount (Stripe's amount ÷ 100), type, and the card's Stripe id, brand, name, last 4, expiry and billing address. | force-app/main/default/classes/BRSS_PaymentUtils.cls:40-67; force-app/main/default/classes/BRSS_PaymentManager.cls:417-421,458-480 |
| R-ORD-130 | For Charge and 0-Amount records an amount breakdown text is stored: "Subtotal / Discount / Tax / Tip / Total". Authorize records have none. | force-app/main/default/classes/BRSS_PaymentUtils.cls:10-11,24-34 |
| R-ORD-131 | A payment's record owner is forced to be the order's customer. | force-app/main/default/flows/BRSS_PaymentOwnership.flow-meta.xml:42-52,100-148 |
| R-ORD-132 | Double-charge guard: each wizard session has one operation token (a millisecond timestamp). The payment step refuses to run if a payment with that order + token already exists. | force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:54,388-394; force-app/main/default/classes/BRSS_PaymentUtils.cls:83-93; force-app/main/default/objects/Payment__c/fields/OperationToken__c.field-meta.xml:5 |
| R-ORD-133 | Refund bookkeeping fields exist on the payment (`Refunded__c` — "This is a manual process", `Refund_Amount__c`, `Refund_Notes__c`); no code reads or writes them. | force-app/main/default/objects/Payment__c/fields/Refunded__c.field-meta.xml:4-9; force-app/main/default/objects/Payment__c/fields/Refund_Amount__c.field-meta.xml:6-10; force-app/main/default/objects/Payment__c/fields/Refund_Notes__c.field-meta.xml:6-9 |

### 5.4 Save-then-pay sequence, failure handling, what `BRSS_TransactionManager` does

| ID | Rule | Citation |
|---|---|---|
| R-ORD-134 | Every paid operation runs as two separate server requests: (1) save all record changes and commit; (2) the page immediately calls back to charge the card. | force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:333-384,386-414; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:841-848; force-app/main/default/pages/BRSS_OrderDetails.page:21,294-301 |
| R-ORD-135 | Because step 1 is already committed, a failed payment is undone by hand. `BRSS_TransactionManager` is the list of what step 1 did: new records (orders, appointments, order items, order-article links, 0-amount payments), before/after copies of updated orders and order items, and deleted order items. | force-app/main/default/classes/BRSS_TransactionManager.cls:10-26,32-45,142-157 |
| R-ORD-136 | Undo on payment failure: delete every new record, write the old order and old order-item values back, and re-insert deleted order items as new copies (order items cannot be undeleted). All three steps ignore individual errors. | force-app/main/default/classes/BRSS_TransactionManager.cls:90-136,159-164; force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:406-410 |
| R-ORD-137 | If step 1 itself fails, it is rolled back as a normal database transaction and the user sees "… operation failed."; nothing is charged. | force-app/main/default/classes/BRSS_OrderUtils.cls:52-56,78-89,96-99,129-141; force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:183,250-273; force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:39,264-278,376-382 |
| R-ORD-138 | Payment failure message: "<payment label> failed (<Stripe messages>)". After a failure the wizard stays open and can be retried; after success it is locked ("operation completed"). | force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:41-42,153-161,280-296,349 |
| R-ORD-139 | The only automatic refund: in the complex wizard, if the authorization on the main order succeeded but the supplies charge then failed, a refund is requested for the authorization charge with no amount given (so the whole charge) and Stripe reason "duplicate", and both new orders are undone. | force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:262-282; force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:406-410; force-app/main/default/classes/BRSS_PaymentManager.cls:425-456; force-app/main/default/classes/BRSS_StripeRefundManager.cls:12; force-app/main/default/classes/BRSS_StripeRefund_In.cls:18,31-37 |
| R-ORD-140 | Payment records and the Stripe-id update are saved with errors ignored, so a failure to save them does not surface to the user. | force-app/main/default/classes/BRSS_PaymentManager.cls:460-479 |

---

## 6. Order detail page (`BRSS_OrderDetails`)

| ID | Rule | Citation |
|---|---|---|
| R-ORD-150 | The page loads one order by id and only if the logged-in user is its customer; otherwise "Order not found". It is therefore a customer page, not a staff page. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:12-16,51-75; force-app/main/default/pages/BRSS_OrderDetails.page:12 |
| R-ORD-151 | Header: order number, types (comma-separated), status, and a pre-arrival notice when the order is pre-arrival. | force-app/main/default/pages/BRSS_OrderDetails.page:31-47 |
| R-ORD-152 | "Items Under Management": article number, type, subtype, description, status (newest link first). Shown only if there are articles. | force-app/main/default/pages/BRSS_OrderDetails.page:60-91; force-app/main/default/classes/BRSS_OrderDetailsController.cls:65-71 |
| R-ORD-153 | "Expenses": every order item — number, status (New/Paid), product name, price, quantity, amount, article. | force-app/main/default/pages/BRSS_OrderDetails.page:93-134 |
| R-ORD-154 | "Payments": payment number, type, card brand + last 4, amount (newest first). | force-app/main/default/pages/BRSS_OrderDetails.page:136-162; force-app/main/default/classes/BRSS_OrderDetailsController.cls:62-64 |
| R-ORD-155 | "Appointments": all appointments, earliest first. | force-app/main/default/pages/BRSS_OrderDetails.page:164-169; force-app/main/default/classes/BRSS_OrderDetailsController.cls:57-61 |
| R-ORD-156 | Action "Extend Storage" → `start_ExtendStorage` (conditions R-ORD-092); two steps: additional term, payment. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:128-135; force-app/main/default/pages/BRSS_OrderDetails.page:49,201-303 |
| R-ORD-157 | Action "Deliver Stored Items" → `start_DeliverStoredArticles` (conditions R-ORD-097); one step: appointment form. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:137-144; force-app/main/default/pages/BRSS_OrderDetails.page:50,311-325 |
| R-ORD-158 | Action "Ship Stored Items" → `start_ShipHomeStoredArticles` (conditions R-ORD-101); two steps: destination, payment. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:146-153; force-app/main/default/pages/BRSS_OrderDetails.page:51,333-436 |
| R-ORD-159 | Action "Cancel Order" → `cancelOrder`, behind a browser confirm (conditions R-ORD-018). | force-app/main/default/classes/BRSS_OrderDetailsController.cls:178-207; force-app/main/default/pages/BRSS_OrderDetails.page:52 |
| R-ORD-160 | Each sub-flow has a "Cancel" link (`deactivateManagers`) that discards it; on success the page reloads the order. Payment for the active sub-flow goes through `processPaymentInActiveManager`. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:155-176,213-229; force-app/main/default/pages/BRSS_OrderDetails.page:204,314,336 |
| R-ORD-161 | Staff side: the only custom staff entry point in the repo is a "Process Order" button on the Order record that opens the phone processing page. | force-app/main/default/objects/Order/webLinks/ProcessOrder.webLink-meta.xml:3-9; force-app/main/default/pages/BRSS_SF1_ProcessOrder.page:1-9 |

---

## 7. Field (phone) order processing — step by step

Entry: page `BRSS_SF1_ProcessOrder`, opened with either an order id or an appointment id.

| ID | Step and rule | Citation |
|---|---|---|
| R-ORD-170 | **Open.** The id may be an appointment (its order is used) or an order. If no order or no customer is found: "Order or customer cannot be identified." The payer is always the order's customer, not the crew member. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:60-75,81-84,302-305; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:116-119 |
| R-ORD-171 | Four screens in order: Manage New Articles → Add Products & Fees → Payment Details → Payment. Only the first two are mandatory. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:102-122; force-app/main/default/classes/BRSS_WizardProcess.cls:108-119,162-173 |
| R-ORD-172 | **Step 1, Manage New Articles.** Buttons: New, Historical Articles (if any), Next. Lists: New Articles (edit/delete), Selected Historical Articles (remove; edit only per R-ORD-074), Existing Order Articles (read-only). Rules R-ORD-065 to R-ORD-074 apply. | force-app/main/default/components/BRSS_SF1_OrderProcessing.component:171-260 |
| R-ORD-173 | Step 1 may be left with zero articles (nothing checks for at least one). | force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:181-191; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:1010-1024 |
| R-ORD-174 | **Step 2, Add Products & Fees.** On every entry the automatic lines are rebuilt from the current article list (R-ORD-032 to R-ORD-043), the order's existing unpaid lines are re-read, and the pending-delete list is emptied; manual lines are kept. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:333-345; force-app/main/default/classes/BRSS_OP_OrderItemsManager.cls:126-148,174-178; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:548-550,580-583,594-596 |
| R-ORD-175 | Step 2 shows a running subtotal and three lists — Auto Generated, Manually Created, Existing Unpaid — each line removable. Removing an existing unpaid line deletes it from the order on completion. Buttons: Back, New (R-ORD-047), Complete, Next. | force-app/main/default/components/BRSS_SF1_OrderProcessing.component:519-619; force-app/main/default/classes/BRSS_OP_OrderItemsManager.cls:150-168,251-264; force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:209-210 |
| R-ORD-176 | **"Complete" on step 2 = finish without payment** (after a confirm). Saves the article links, the automatic and manual lines with status New, and deletes removed lines. Existing unpaid lines are left untouched, discount/tip are not applied, and no payment record of any kind is written. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:124-143,145-159,387-399; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:529-531; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:937-957 |
| R-ORD-177 | "Next" on step 2 asks "Have you added all products and fee?". | force-app/main/default/components/BRSS_SF1_OrderProcessing.component:532-534 |
| R-ORD-178 | **Step 3, Payment Details.** Shows subtotal, discount (amount or %), tax, tip (amount or %), total; recalculated live on the phone and again on the server when leaving the step. Discount cap per R-ORD-116. | force-app/main/default/components/BRSS_SF1_OrderProcessing.component:706-808; force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:307-318,346-360 |
| R-ORD-179 | **Step 4, Payment.** If total > 0: card form (saved cards or new card, no terms checkbox). If total = 0: notice "The payment step is skipped, because total amount is equal to 0." "Complete" asks for confirmation. | force-app/main/default/components/BRSS_SF1_OrderProcessing.component:815-835; force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:312-317 |
| R-ORD-180 | **Completion with payment.** In one transaction: create article links; update order discount/tip; save automatic + manual + existing unpaid lines all as Paid; delete removed lines; write a 0-Amount payment if total is 0. Then (total > 0) charge the card and write the Charge payment; on card failure everything is undone (R-ORD-136) and the crew can retry. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:181-248,289-300,363-381; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:688-717,1057-1063 |
| R-ORD-181 | Result screen shows "Service the order operation completed." and "Payment for the selected order items was completed." (or the failure texts). | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:22-23; force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:38-42; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:161-165 |
| R-ORD-182 | Processing can be run again on the same order (more articles later, or just to collect earlier unpaid lines): unpaid lines from earlier runs reappear in step 2. | force-app/main/default/classes/BRSS_OP_OrderItemsManager.cls:134-140; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:1018-1024 |
| R-ORD-183 | Things processing does not do: set article status or location, change order status, change the storage term, create or complete appointments. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:145-159,181-248; force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:187-254 |

---

## 8. E-mails and notifications

No Apex in scope sends an order, article or payment e-mail. All of these are workflow e-mail alerts; the templates themselves are not in the repo.

| ID | Rule | Active? | Citation |
|---|---|---|---|
| R-ORD-190 | "Customer Order Receipt": on order creation only, when order total > 0 and status Open → to the customer and one fixed internal user. | active | force-app/main/default/workflows/Order.workflow-meta.xml:61-75,209-228 |
| R-ORD-191 | "Customer Order Request": on create or edit, when the order was created today and its type matches the rule's list (Ship to Cornell, Ship to Home, Storage) → to the customer and one fixed internal user. | active | force-app/main/default/workflows/Order.workflow-meta.xml:76-90,229-248 |
| R-ORD-192 | "BRSS Ship to Cornell": on create or edit, when types include Ship to Cornell → to the account owner. | active | force-app/main/default/workflows/Order.workflow-meta.xml:25-34,156-169 |
| R-ORD-193 | "BRSS Shipping Request": on create or edit, when status is Open and types include Ship to Home → to one fixed internal user, sent as the current user. | active | force-app/main/default/workflows/Order.workflow-meta.xml:91-101,170-189 |
| R-ORD-194 | "Schedule Delivery Reminder": when Days Until Delivery equals 20, a time-based e-mail is queued for 20 days before Storage Delivery By → to the customer (storage-term-ending template). | active | force-app/main/default/workflows/Order.workflow-meta.xml:130-141,294-312 |
| R-ORD-195 | "BRSS Box Greater than 70": when an order-article link is created or edited and the article's actual weight is > 70 lb → to the account owner, with one external address in copy. | active | force-app/main/default/workflows/OrderArticle__c.workflow-meta.xml:3-13,14-28 |
| R-ORD-196 | Defined but switched off: Cancelled Order e-mail; Storage Term Ending (30 days, delivery not scheduled); Delivery Past Due (days ≤ −1); "Email Alert: Customer Order"; "NewRuleExample"; Peak Fee on a payment of one specific amount. | inactive | force-app/main/default/workflows/Order.workflow-meta.xml:142-155,190-208,249-293; force-app/main/default/workflows/Payment__c.workflow-meta.xml:18-32 |
| R-ORD-197 | The only Apex e-mail utility in the listed classes sends an e-mail-address confirmation code (account settings), not order mail. | n/a | force-app/main/default/classes/BRSS_EmailConfirmationUtils.cls:10-13,34-48 |

---

## 9. Settings and hard-coded constants

### 9.1 `BRSS_HierarchySettings__c` (read as org-wide defaults only)

| ID | Setting | What it controls | Citation |
|---|---|---|---|
| R-ORD-200 | (all) | Although a hierarchy setting, the code always reads the org default, never a per-profile/per-user value. | force-app/main/default/classes/BRSS_SettingsUtils.cls:36-52 |
| R-ORD-201 | `TaxPercentage__c` | Tax rate (whole percent) for every charge and for the order tax formula. | force-app/main/default/classes/BRSS_SettingsUtils.cls:54-58; force-app/main/default/objects/Order/fields/Tax__c.field-meta.xml:5; force-app/main/default/objects/BRSS_HierarchySettings__c/fields/TaxPercentage__c.field-meta.xml:8-12 |
| R-ORD-202 | `AuthorizationAmount__c` | Amount of the booking authorization. | force-app/main/default/classes/BRSS_SettingsUtils.cls:60-64 |
| R-ORD-203 | `MaxDiscountByNonAdmin__c` | Discount cap (percent) for non-admin crew. | force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:351-352 |
| R-ORD-204 | `AdminPofilesIds__c` | Comma-separated profile ids treated as admin (100 % discount allowed). | force-app/main/default/classes/BRSS_SettingsUtils.cls:79-95 |
| R-ORD-205 | `StripeSecretApiKey__c` | Stripe secret key (stored as plain text in the setting). | force-app/main/default/classes/BRSS_StripeRequest.cls:22-29; force-app/main/default/objects/BRSS_HierarchySettings__c/fields/StripeSecretApiKey__c.field-meta.xml:4-11 |
| R-ORD-206 | `DefaultAccount__c` | Account used for orders of customers without their own account. | force-app/main/default/classes/BRSS_OrderUtils.cls:17 |
| R-ORD-207 | `ShipToHomeProductId__c` | Product for ship-home lines. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:350-352 |
| R-ORD-208 | `ShipToCornellProductId__c` | Product for weight-priced ship-to-Cornell lines. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:398-400 |
| R-ORD-209 | `FlatRateProductId_CornellShipping__c` | Flat-fee product for boxes on the Cornell account. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:394-395 |
| R-ORD-210 | `FlatRateProductId_OtherShipping__c` | Flat-fee product for boxes on a third-party account (also the price quoted in the customer wizard). | force-app/main/default/classes/BRSS_OrderItemUtils.cls:391-392; force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:370-375 |
| R-ORD-211 | `InsuranceProductId__c` | Product for insurance lines. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:424-426 |
| R-ORD-212 | `OtherNonBoxedProductId__c` | The "Other" non-boxed product whose price is typed in by the crew. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:97-98; force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:87-88 |
| R-ORD-213 | `PrearrivalProductId__c` | Product added when the customer selects pre-arrival. | force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:170-172 |
| R-ORD-214 | `RegionsWithPrearrival__c` | Regions (one per line) where pre-arrival may be offered. | force-app/main/default/classes/BRSS_SettingsUtils.cls:66-77; force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:326-329 |
| R-ORD-215 | `BlockedNextDaysForAppointment__c` | Number of upcoming days in which appointments cannot be booked (also applies to the delivery-from-storage form). | force-app/main/default/components/BRSS_Form_Appointment.component:119; force-app/main/default/objects/BRSS_HierarchySettings__c/fields/BlockedNextDaysForAppointment__c.field-meta.xml:4-5 |
| R-ORD-216 | `OWEA_Id_ConfirmationSender__c` | Sender address id for confirmation-code e-mails. | force-app/main/default/classes/BRSS_EmailConfirmationUtils.cls:39-40 |
| R-ORD-217 | `PackingProductId__c`, `PackingProductId_Peak__c` | Defined ("packing for usual / peak periods") but not read by any class, page or component in the repo. | force-app/main/default/objects/BRSS_HierarchySettings__c/fields/PackingProductId__c.field-meta.xml:3-4; force-app/main/default/objects/BRSS_HierarchySettings__c/fields/PackingProductId_Peak__c.field-meta.xml:3-4 |

### 9.2 Other configuration and constants

| ID | Item | What it controls | Citation |
|---|---|---|---|
| R-ORD-218 | `BRSS_StorageTermProduct__c` (list setting: term in months, overweight flag, product id) | Which storage product prices a Standard Box for a given term (R-ORD-034). | force-app/main/default/classes/BRSS_SettingsUtils.cls:150-167; force-app/main/default/objects/BRSS_StorageTermProduct__c/fields/ProductId__c.field-meta.xml:3-9 |
| R-ORD-219 | `ZipZone__c`, `ZoneWeight__c` (data tables) | Zip-prefix → zone, and (zone, weight) → ship-home price and ship-to-Cornell price. | force-app/main/default/classes/BRSS_ZipZoneDAO.cls:24-27; force-app/main/default/classes/BRSS_ZoneWeightDAO.cls:24-26 |
| R-ORD-220 | Price book | Always the org's standard price book unless the order already has one. | force-app/main/default/classes/BRSS_PricebookDAO.cls:10-21; force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:91-106 |
| R-ORD-221 | Hard-coded: overweight threshold 70 lb; max box weight 150 lb; insurance rate 10 %; dimensional divisor 166 (Apex) / 139 (field); peak month 5 (unused). | Pricing and validation constants that are not configurable. | force-app/main/default/classes/BRSS_SettingsUtils.cls:10-18,97-100; force-app/main/default/classes/BRSS_ArticleDAO.cls:14; force-app/main/default/objects/Article__c/fields/BillableWeight__c.field-meta.xml:6 |
| R-ORD-222 | Hard-coded: product name "* Supplies Delivery". | Auto-added supplies delivery line (R-ORD-046). | force-app/main/default/classes/BRSS_OrderItemUtils.cls:189 |

---

## 10. Open questions, ambiguities, apparent bugs, dead code

Each item states only what the files show; the decision is for the business.

### 10.1 Things the rewrite cannot decide from the code

| ID | Question | Citation |
|---|---|---|
| Q-ORD-01 | **No staff order page exists in the repo.** `BRSS_OrderDetails` is customer-only (R-ORD-150). What staff see is the standard Salesforce Order layout, which is not in the repo (no layouts, quick actions or Lightning pages were retrieved). The staff view has to be specified from the live org or from staff. | force-app/main/default/classes/BRSS_OrderDetailsController.cls:72-73; force-app/main/default/objects/Order/webLinks/ProcessOrder.webLink-meta.xml:3-9 |
| Q-ORD-02 | **Who moves an order to Activated and to Closed, and when?** Nothing in the repo does. Closed has real consequences (all articles become Delivered; order leaves the customer's active list). The Status picklist values themselves are not in the repo either (only four are named in code). | force-app/main/default/classes/BRSS_OrderDAO.cls:20-23; force-app/main/default/objects/Order/fields/Status.field-meta.xml:3-5; force-app/main/default/flows/BRSS_Update_Order_Article_Status.flow-meta.xml:54-57 |
| Q-ORD-03 | **Billable weight: 139 or 166?** Pricing and the 150-lb database rule use the stored field (÷139). The phone display and the 1–150 pre-check use ÷166. A box can show one billable weight on the phone and be billed at a higher one; a box the pre-check accepts can still be rejected on save. | force-app/main/default/objects/Article__c/fields/BillableWeight__c.field-meta.xml:6; force-app/main/default/classes/BRSS_ArticleDAO.cls:14; force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:199-200; force-app/main/default/classes/BRSS_OrderItemUtils.cls:456 |
| Q-ORD-04 | **The booking authorization is never captured or released by code.** There is no capture or void call; an Authorize payment just stays. Is the authorization only a card check? Is the real amount always taken by a new charge at pickup? | force-app/main/default/classes/BRSS_CreateComplexOrderController.cls:256-258; force-app/main/default/classes/BRSS_StripeChargeManager.cls:10 |
| Q-ORD-05 | **Two competing rules set the storage effective date** (first captured charge vs. completed pickup appointment); whichever fires first wins and it is never corrected. The appointment rule says "Currently not being used because of the payment process" but is Active. Which is the intended rule? | force-app/main/default/flows/BRSS_StorageEffectiveDateAppointment.flow-meta.xml:128,269; force-app/main/default/flows/BRSS_StorageEffectiveDatePayment.flow-meta.xml:97,238 |
| Q-ORD-06 | **Effective date can be started by a non-storage charge.** Any captured charge on an order whose types include Storage sets it (e.g. a manual supplies line paid before pickup, or an Extend Storage payment on an order that never had one). Conversely a storage order closed out with 100 % discount or "Complete without payment" gets no effective date from payments. | force-app/main/default/flows/BRSS_StorageEffectiveDatePayment.flow-meta.xml:54-58,85-89; force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:213-221,387-399 |
| Q-ORD-07 | The effective date (a date) is filled from the payment's creation timestamp; which time zone decides the day is not visible in the repo. | force-app/main/default/flows/BRSS_StorageEffectiveDatePayment.flow-meta.xml:230-232; force-app/main/default/objects/Order/fields/Storage_Effective_Date__c.field-meta.xml:9 |
| Q-ORD-08 | **Refunds and cancellations.** Cancelling an order does nothing about money, and refunds are a manual Stripe-dashboard process recorded by hand. What is the cancellation/refund policy the new app should enforce? | force-app/main/default/classes/BRSS_OrderDetailsController.cls:185-198; force-app/main/default/objects/Payment__c/fields/Refunded__c.field-meta.xml:5 |
| Q-ORD-09 | **Article status has no enforced order.** Any status can follow any other; the intended sequence (truck → warehouse → stored → ready → truck → delivered, or → ready for shipment → shipped) is only implied by the labels. "In Warehouse" vs "Stored" is not distinguished by any rule except R-ORD-076. Confirm the intended sequence with warehouse staff. | force-app/main/default/objects/Article__c/fields/Status__c.field-meta.xml:13-52; force-app/main/default/workflows/Article__c.workflow-meta.xml:21-37 |
| Q-ORD-10 | **Three separate places hold a location** (article fields; order-level notes; order item + `Warehouse__c` record) with different warehouse lists (2 values on the article, 4 on the order, an unretrieved value set on the order item). Which one do staff actually use? | force-app/main/default/objects/Article__c/fields/Warehouse__c.field-meta.xml:13-19; force-app/main/default/objects/Order/fields/Warehouse_Notes__c.field-meta.xml:13-28; force-app/main/default/objects/OrderItem/fields/Warehouse__c.field-meta.xml:9-12 |
| Q-ORD-11 | **Labels/barcodes:** nothing in the repo prints or scans a label. Articles are identified only by the `A-000000` number. How boxes are physically labelled is not in the code. | force-app/main/default/objects/Article__c/Article__c.object-meta.xml:158-162 |
| Q-ORD-12 | **Org data not in the repo:** products, price book prices, storage-term product rows, zone tables, tax percentage, authorization amount, discount cap, e-mail templates. All prices and the actual storage terms on offer depend on them. | force-app/main/default/classes/BRSS_SettingsUtils.cls:51,152; force-app/main/default/classes/BRSS_PricebookDAO.cls:14; force-app/main/default/classes/BRSS_ZoneWeightDAO.cls:24-26 |
| Q-ORD-13 | **Flat-rate box price × months.** A flat-rate box is listed to the crew as "name - $price" but billed at price × storage months. Is the listed price per month? | force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:150; force-app/main/default/classes/BRSS_OrderItemUtils.cls:113-116 |
| Q-ORD-14 | **Packing charges.** Packing orders are created with no items, the two packing product settings are unread and "peak month" logic is commented out. How packing is actually billed (presumably a manual line at processing) is not in code. | force-app/main/default/classes/BRSS_CreatePackingOrderController.cls:82-84; force-app/main/default/classes/BRSS_SettingsUtils.cls:10,97-100 |
| Q-ORD-15 | **Express record type:** defined, described as "Express Order Creation", used by no code in the repo. | force-app/main/default/objects/Order/recordTypes/Express.recordType-meta.xml:3-5 |
| Q-ORD-16 | `Counter__c` on the order and campus category "Counter" suggest walk-in counter orders; no code uses them. | force-app/main/default/objects/Order/fields/Counter__c.field-meta.xml:3-8; force-app/main/default/objects/Order/recordTypes/Default.recordType-meta.xml:7-11 |

### 10.2 Apparent bugs and risky behaviour (confirm before copying)

| ID | Finding | Citation |
|---|---|---|
| Q-ORD-20 | **"Storage Delivery By" looks one year late when start month + term is a multiple of 12** (e.g. August + 4, June + 6, April + 8 → December). The year term adds floor((month + term) / 12) = 1 while the month resolves to December, and the only correction covers December starts with terms ≥ 12. The plain expiration formula (R-ORD-089) does not have this problem. This date feeds the delivery deadline and reminders. Needs a check against real orders. | force-app/main/default/objects/Order/fields/StorageDeliveryBy__c.field-meta.xml:6-9; force-app/main/default/objects/Order/fields/Storage_Expiration_Date__c.field-meta.xml:5 |
| Q-ORD-21 | **Records are committed before the card is charged.** If the second request never arrives (lost signal on the phone, closed tab), items stay marked Paid, links and discounts stay saved, and no payment exists. The undo only runs when the charge is attempted and fails. | force-app/main/default/classes/BRSS_BasicOrderEditorController.cls:363-369,386-414; force-app/main/default/components/BRSS_SF1_OrderProcessing.component:841-848 |
| Q-ORD-22 | The undo is best-effort: every step ignores errors, deleted order items come back as new records with new ids, and automations that already fired (e-mails, pre-arrival flag, effective date) are not reversed. | force-app/main/default/classes/BRSS_TransactionManager.cls:94-95,119-120,125-135 |
| Q-ORD-23 | Articles are saved outside the undo: an article created in step 1 stays in the database (unlinked to any order) if processing is abandoned or the payment fails. | force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:214-215; force-app/main/default/classes/BRSS_TransactionManager.cls:14,34 |
| Q-ORD-24 | A new Stripe customer is created with the **logged-in user's** e-mail. In crew processing that is the crew member, while the customer described is the order's customer. | force-app/main/default/classes/BRSS_PaymentManager.cls:213-217; force-app/main/default/classes/BRSS_OrderProcessingCtrl.cls:302-305 |
| Q-ORD-25 | Card numbers and CVCs pass through the application server (R-ORD-122), and the Stripe secret key sits in a plain-text setting (R-ORD-205). A rewrite should not reproduce either. | force-app/main/default/classes/BRSS_PaymentManager.cls:126-143; force-app/main/default/classes/BRSS_StripeRequest.cls:25-29 |
| Q-ORD-26 | Missing configuration fails silently: no storage-term row at or below the term, no active price book entry, no zone for the zip, or no zone/weight row → the line is simply not generated and the customer is not charged for it. | force-app/main/default/classes/BRSS_SettingsUtils.cls:175-188; force-app/main/default/classes/BRSS_OrderItemUtils.cls:22-26,35,131-143,163; force-app/main/default/classes/BRSS_UT_OrderProcessing.cls:207-208 |
| Q-ORD-27 | Two different "70 lb" tests: pricing treats billable weight ≥ 70 as overweight; the e-mail alert fires on actual weight > 70. | force-app/main/default/classes/BRSS_SettingsUtils.cls:11,102-105; force-app/main/default/workflows/OrderArticle__c.workflow-meta.xml:21-25 |
| Q-ORD-28 | Extend Storage re-bills **every** article ever linked to the order, including ones already Delivered or Shipped; article status is not checked. | force-app/main/default/classes/BRSS_ExtendStorageController.cls:68-76 |
| Q-ORD-29 | Extend Storage with a Standard Box uses the storage-term product for the *additional* months only (4/6/8, nearest shorter row), not a per-month rate, so the price of an extension depends on which term rows exist. | force-app/main/default/classes/BRSS_ExtendStorageController.cls:74-75; force-app/main/default/classes/BRSS_OrderItemUtils.cls:320-329 |
| Q-ORD-30 | The customer can tick or untick "Pre-arrival delivery" while extending storage; it is saved straight onto the order with no product, charge or region check, and ticking it hides the delivery button. | force-app/main/default/components/BRSS_Form_StorageOptions.component:59; force-app/main/default/pages/BRSS_OrderDetails.page:231; force-app/main/default/classes/BRSS_OrderDetailsController.cls:101 |
| Q-ORD-31 | Ship Stored Items silently ignores non-boxed items and flat-rate boxes, yet still marks the whole order "delivery scheduled", which blocks scheduling a delivery for the remaining items. | force-app/main/default/classes/BRSS_OrderItemUtils.cls:345-352; force-app/main/default/classes/BRSS_ShipHomeStoredArticlesCtrl.cls:99; force-app/main/default/classes/BRSS_OrderDetailsController.cls:101-108 |
| Q-ORD-32 | Historical articles can be attached whatever their status (even Delivered or Shipped) and re-billed for storage. | force-app/main/default/classes/BRSS_OP_ArticlesManager.cls:116-124 |
| Q-ORD-33 | The order tax/total formulas count every order item, Paid or New, and one cumulative discount; they are not the sum of actual payments. Which figure is "what the customer owes"? | force-app/main/default/objects/Order/fields/Tax__c.field-meta.xml:5; force-app/main/default/objects/Order/fields/OrderTotal__c.field-meta.xml:5 |
| Q-ORD-34 | The Delivered automation fires on any edit of a link whose order is Closed, so manually correcting an article on a closed order can be overwritten back to Delivered the next time the link is touched. | force-app/main/default/flows/BRSS_UpdateArticleStatusDelivered.flow-meta.xml:54-57,90 |
| Q-ORD-35 | "Schedule Delivery Reminder" and "Customer Order Request" depend on a record being created or edited on exactly the right day (formula with today's date; "created today"), so they may fire rarely or more than once. "Customer Order Request" compares a multi-value type with a three-value list; whether combined types (e.g. Storage + Packing) match is not decidable from the file. | force-app/main/default/workflows/Order.workflow-meta.xml:236-247,297-311 |
| Q-ORD-36 | "BRSS Shipping Request" re-fires on every qualifying edit of an Open order that includes Ship to Home. | force-app/main/default/workflows/Order.workflow-meta.xml:170-189 |
| Q-ORD-37 | Card length check rejects numbers longer than 16 digits. | force-app/main/default/classes/BRSS_PaymentManager.cls:31-32,129-130 |
| Q-ORD-38 | The currency sent to Stripe is the logged-in user's default currency, not a fixed one. | force-app/main/default/classes/BRSS_PaymentManager.cls:292 |
| Q-ORD-39 | Default price book trigger: a null check is computed and then ignored (would error if no standard price book). | force-app/main/default/classes/BRSS_OrderUtils.cls:163-169 |

### 10.3 Dead or unfinished code

| ID | Finding | Citation |
|---|---|---|
| Q-ORD-50 | `OrderItemController` (returns any 10 order items with warehouse/location; bulk update) has no caller in the repo — no Lightning component was retrieved. Looks like an unfinished warehouse-location screen. | force-app/main/default/classes/OrderItemController.cls:2-31 |
| Q-ORD-51 | `BRSS_CompleteComplexOrderController` only shows a "…order operation completed" message from a URL parameter. | force-app/main/default/classes/BRSS_CompleteComplexOrderController.cls:2-7,16-44 |
| Q-ORD-52 | Article status constants (In Warehouse, Delivered, Shipped) are declared but only used in commented-out dashboard code and tests. | force-app/main/default/classes/BRSS_ArticleDAO.cls:18-20; force-app/main/default/classes/BRSS_OrdersDashboardController.cls:109-113 |
| Q-ORD-53 | `BRSS_PaymentManager_IExtlCtrl` is an interface with one method (fill billing address); the "Fill Address" button is off by default. | force-app/main/default/classes/BRSS_PaymentManager_IExtlCtrl.cls:13-17; force-app/main/default/components/BRSS_Form_Payment.component:4-5,71-75 |
| Q-ORD-54 | Transaction-manager lists for new articles are declared and cleared but never filled. | force-app/main/default/classes/BRSS_TransactionManager.cls:14,34,57 |
| Q-ORD-55 | Flow "BRSS Update Order Owner" is Obsolete (the trigger does this now); flow "correct_zeroes" is a Draft; partial refunds are supported by the Stripe wrapper (`amount`) but never used. | force-app/main/default/flows/BRSS_Update_Order_Owner.flow-meta.xml:72,170; force-app/main/default/flows/correct_zeroes.flow-meta.xml:30,91; force-app/main/default/classes/BRSS_StripeRefund_In.cls:24 |
| Q-ORD-56 | A "Small Box" (12-inch) shortcut and "< 1" / "1-2" month storage options are commented out. | force-app/main/default/components/BRSS_SF1_StandardBox.component:14; force-app/main/default/components/BRSS_Form_StorageOptions.component:10-11,34-38 |
