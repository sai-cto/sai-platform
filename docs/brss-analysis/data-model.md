# BRSS Salesforce data model inventory

Source: `sai-cto/brss-salesforce` at commit `233cf40`, folder `force-app/main/default/` (read-only review). All paths below are relative to that folder unless they start with `docs/` or `manifest/`.
Conventions: "req" = `required=true` in the field file (or enforced by a validation rule, stated). Picklist values are listed in file order; **(default)** marks the default. Standard fields are listed by name only because their field files contain no label/type detail.

**US-state list (used by 3 picklists):** Alabama, Alaska, Arizona, Arkansas, California, Colorado, Connecticut, Delaware, District of Columbia, Florida, Georgia, Hawaii, Idaho, Illinois, Indiana, Iowa, Kansas, Kentucky, Louisiana, Maine, Maryland, Massachusetts, Michigan, Minnesota, Mississippi, Missouri, Montana, Nebraska, Nevada, New Hampshire, New Jersey, New Mexico, New York, North Carolina, North Dakota, Ohio, Oklahoma, Oregon, Pennsylvania, Rhode Island, South Carolina, South Dakota, Tennessee, Texas, Utah, Vermont, Virginia, Washington, West Virginia, Wisconsin, Wyoming (51 values, full names, no codes).

**Not in the repo:** there is no `globalValueSets/` or `standardValueSets/` folder, so the global value sets `Building` and `Warehouses` and the standard picklists `Order.Status`, `Order.Type`, `Product2.Family` have no definition file. Their values are only partly recoverable (see sections 1 and 3).

---

## 1. Objects and fields

### 1.1 Order (standard) — `objects/Order/`
The customer's order: storage, shipping, packing and supplies services, with totals, ship-home address and storage term. Sharing: `ControlledByParent` (the Account).

| API name | Label | Type | Req | Values / target / formula | Notes |
|---|---|---|---|---|---|
| `Customer__c` | Customer | Lookup(User), SetNull, rel `Orders` | by rule | | Validation rule makes it mandatory; trigger copies it to `OwnerId` |
| `Type__c` | Type | Multi-select picklist | no | Packing; Ship to Cornell; Ship to Home; Storage; Supplies | No default. This is the type Apex uses (`BRSS_OrderDAO.TYPE_*`) |
| `Campus_Category__c` | Campus Category | Picklist | no | On-Campus; Off-Campus; Counter | "Category for financial reporting". Set by flow from the appointment |
| `Master_Article_Status__c` | Master Article Status | Picklist | no | Delivered; In Warehouse; On Truck, to delivery; Ready for Delivery; Ready for Shipment; Shipped; Stored; On Truck, to warehouse | Bulk-status lever: flows push it to every article on the order |
| `Warehouse_Notes__c` | Warehouse Notes | Picklist | no | Mecklenburg; Lansing; Overflow; SAI Basement | "SAI Basement" is not enabled on either record type |
| `ShipHomeState__c` | Ship Home State | Picklist | no | US-state list above | No default |
| `NetID__c` | NetID | Text(100) | no | | Synced from the latest appointment with a NetID |
| `Prearrival__c` | Prearrival | Checkbox (false) | | | Help: "Order contains a prearrival product". Set by flow |
| `Counter__c` | Counter | Checkbox (false) | | | |
| `Large_Items__c` | Large Items | Text(100) | no | | "Indicates whether or not the order includes large items." |
| `Order_Location__c` | Order Location | Text(50) | no | | "Warehouse, Pallet Code" |
| `DiscountAmount__c` | Discount | Currency(18,2), default 0 | no | | |
| `TipAmount__c` | Tip | Currency(18,2), default 0 | no | | |
| `Tax__c` | Tax | Formula Currency(18,2) | | `(TotalAmount - DiscountAmount__c) * $Setup.BRSS_HierarchySettings__c.TaxPercentage__c` | |
| `OrderTotal__c` | Order Total | Formula Currency(18,2) | | `TotalAmount + Tax__c + TipAmount__c - DiscountAmount__c` | Blanks as zero |
| `NumArticles__c` | No. Articles | Roll-up summary | | COUNT of `OrderArticle__c` via `OrderArticle__c.Order__c` | |
| `ShipHomeAddressedTo__c` | Ship Home Addressed To | Text(100) | no | | |
| `ShipHomeAddress1__c` / `ShipHomeAddress2__c` | Ship Home Address 1 / 2 | Text(255) | no | | |
| `ShipHomeCity__c` | Ship Home City | Text(40) | no | | |
| `ShipHomeZip__c` | Ship Home Zip | Text(20) | no | | Drives `ShipHomeZone__c` via trigger |
| `ShipHomeZone__c` | Ship Home Zone | Number(2,0) | no | | Set by trigger from `ZipZone__c` |
| `ShipHomePhoneNumber__c` | Ship Home Phone Number | Phone | no | | |
| `ShipHomeDate__c` | Ship Home Date | Date | no | | |
| `ShipToCornellNumPackages__c` | Estimated Number Of Packages | Number(2,0) | no | | |
| `ShipToCornellVendorFlag__c` | 3rd Party Opt-in | Checkbox (false) | | | |
| `StorageTermInMonths__c` | Storage Term In Months | Number(2,0) | no | | |
| `Storage_Effective_Date__c` | Storage Effective Date | Date | no | | "Date when Storage starts. The Deliver By Date will be based on this field plus the length of storage." Set by flows |
| `Storage_Expiration_Date__c` | Storage Expiration Date | Formula Date | | `ADDMONTHS(Storage_Effective_Date__c , StorageTermInMonths__c)` | |
| `StorageDeliveryBy__c` | Storage Delivery By | Formula Date | | see below | Hand-rolled "add months" |
| `Days_Until_Delivery__c` | Days Until Delivery | Formula Number(18,0) | | `StorageDeliveryBy__c - Today()` | Used by workflow rules |
| `StorageDeliveryScheduled__c` | Storage Delivery Scheduled | Checkbox (false) | | | |

`StorageDeliveryBy__c` formula (verbatim, `objects/Order/fields/StorageDeliveryBy__c.field-meta.xml`):
```
DATE(
year(Storage_Effective_Date__c)
+ floor((month(Storage_Effective_Date__c) + StorageTermInMonths__c)/12) + if(and(month(Storage_Effective_Date__c)=12,StorageTermInMonths__c>=12),-1,0)
,
if( mod( month(Storage_Effective_Date__c) + StorageTermInMonths__c, 12 ) = 0, 12 , mod( month(Storage_Effective_Date__c) + StorageTermInMonths__c, 12 ))
,
min(
day(Storage_Effective_Date__c),
case(
max( mod( month(Storage_Effective_Date__c) + StorageTermInMonths__c, 12 ) , 1),
9,30, 4,30, 6,30, 11,30,
2,if(mod((year(Storage_Effective_Date__c)
+ floor((month(Storage_Effective_Date__c) + StorageTermInMonths__c)/12) + if(and(month(Storage_Effective_Date__c)=12,StorageTermInMonths__c>=12),-1,0)),4)=0,29,28),
31
)))
```
(Line breaks in the `case` argument list condensed; tokens unchanged.)

Standard fields with a field file (30): `AccountId`, `AccountNumber`, `ActivatedById`, `ActivatedDate`, `BillToContactId`, `BillingAddress`, `CompanyAuthorizedById`, `CompanyAuthorizedDate`, `ContractEndDate`, `ContractId`, `ContractName`, `CustomerAuthorizedById`, `CustomerAuthorizedDate`, `Description`, `EffectiveDate`, `EndDate`, `IsReductionOrder`, `Name`, `OpportunityId`, `OrderReferenceNumber`, `OriginalOrderId`, `OwnerId`, `PoDate`, `PoNumber`, `Pricebook2Id`, `ShipToContactId`, `ShippingAddress`, `Status` (picklist), `TotalAmount`, `Type` (picklist).

- **Validation rule** `BRSS_CustomerExists` (active): `Customer__c == null` → "Customer must be set" (on `Customer__c`). `objects/Order/validationRules/BRSS_CustomerExists.validationRule-meta.xml`
- **Record types** (both active, identical picklist assignments): `Default`; `Express` ("Used for Express Order Creation"). Both enable `Status` = Activated, Cancelled, Closed, NonActivated, Open; standard `Type` = Packing, Storage, Supplies; `Type__c` all 5; `Campus_Category__c` all 3; `Master_Article_Status__c` all 8; `Warehouse_Notes__c` = Lansing, Mecklenburg, Overflow only. No defaults set.
- **Button** `ProcessOrder` ("Process Order") opens Visualforce page `BRSS_SF1_ProcessOrder`.
- **List views:** `Created_Today`; `Pre_Arrival_18` (EffectiveDate 7/1–7/15/2018, TotalAmount > 0, `Type__c` = Ship to Cornell, Status ≠ Cancelled); `Storage_Orders` (standard `Type` = Storage and Campus Category = On-Campus); `X12_1_2021_to_Today` (label "Past Years", `StorageDeliveryBy__c` > 12/1/2017).

### 1.2 OrderItem (standard, "Order Product") — `objects/OrderItem/`
A priced line on an order (a product from the price book), optionally tied to a physical article.

| API name | Label | Type | Req | Values / target / formula | Notes |
|---|---|---|---|---|---|
| `Article__c` | Article | Lookup(Article__c), SetNull, rel `OrderProducts` | no | | |
| `Article_Description__c` | Article Description | Formula Text | | `Article__r.Description__c` | |
| `Status__c` | Status | Picklist | no | **New (default)**; Paid | Line-level payment state |
| `Warehouse__c` | Warehouse | Picklist, restricted, global value set `Warehouses` | no | values not in repo | Mirrored to `Warehouse__c` object by flow |
| `Location__c` | Location | Text(255) | no | | Mirrored to `Warehouse__c` object by flow |

Standard fields with a file: `AvailableQuantity`, `Description`, `EndDate`, `ListPrice`, `OrderId`, `OriginalOrderItemId`, `Product2Id`, `ProductCode`, `Quantity`, `QuantityUnitOfMeasureId`, `ServiceDate`, `SubscriptionTerm`, `TotalPrice`, `UnitPrice`. (`PricebookEntryId` has no file but flow `BRSS_Prearrival` traverses `PricebookEntry.Product2`.)

### 1.3 OrderArticle__c ("Order Article") — `objects/OrderArticle__c/`
Junction between Order and Article (an article can appear on several orders over its life). Name: auto-number `OA-{0000}`. Sharing controlled by parent.

| API name | Label | Type | Req | Target | Notes |
|---|---|---|---|---|---|
| `Order__c` | Order | Master-detail(Order), primary (order 0), rel `OrderArticles`, not reparentable | yes | | |
| `Article__c` | Article | Master-detail(Article__c), secondary (order 1), rel `OrderArticles`, not reparentable | yes | | |
| `Master_Article_Status__c` | Master Article Status | Text(255) | no | | "Used to update the status on articles, should not be updated manually." Relay field for flows |
| `Order_Status__c` | Order Status | Text(255) | no | | Relay field: flow copies `Order.Status` here when Closed |
| `CornellShippingAccount__c` | Cornell Shipping Account | Checkbox (false) | | | |
| `ReceivedFromZip__c` | Received From Zip | Text(20) | no | | |

List view `All` is filtered to CreatedDate < 1/1/2021.

### 1.4 Article__c ("Article") — `objects/Article__c/`
One physical item (box or non-boxed item) held, moved or shipped for a customer. Name: auto-number `A-{000000}`. History tracking on. Sharing reason `BRSS_Customer__c` ("User is a BRSS customer").

| API name | Label | Type | Req | Values / target / formula | Notes |
|---|---|---|---|---|---|
| `Customer__c` | Customer | Lookup(User), SetNull, rel `Articles` | no | | Flow copies it to `OwnerId` |
| `Product__c` | Product | Lookup(Product2), SetNull, rel `Items` | no | | |
| `Status__c` | Status | Picklist | no | Delivered; In Warehouse; On Truck, to delivery; Ready for Delivery; Ready for Shipment; Shipped; Stored; On Truck, to warehouse | No default |
| `Type__c` | Type | Picklist | no | **Non-boxed Item (default)**; Standard Box; Flat Rate Box | |
| `Description__c` | Description | Text(255) | no | | |
| `Weight__c`, `Length__c`, `Width__c`, `Height__c` | Weight / Length / Width / Height | Number(18,0) | no | | Units not stated in field files |
| `BillableWeight__c` | Billable Weight | Formula Number(18,0) | | `CEILING(MAX(Weight__c, (Length__c * Width__c * Height__c / 139.0) ))` | "Maximal value between actual and dimensional weights. The value is rounded up." |
| `AdditionalInsurance__c` | Additional Insurance | Currency(7,2) | no | | |
| `OtherStoragePrice__c` | Other Storage Price | Currency(18,0) | no | | |
| `Warehouse__c` | Warehouse | Picklist (history) | no | Mecklenburg; Lansing | Local values, not the global set |
| `Section__c` | Section | Picklist (history) | no | Boxes; Furniture; TV Room; Bike Room; Mattress Area; Chair; Lamp; Mirror; Fridge; Fan | |
| `Row__c` | Row | Picklist (history) | no | A; B; C; D; E; F; G; H; I; J; K; L; M; N | |
| `Pallet_Number__c` | Pallet Number | Number(2,0) (history) | no | | |

- **Validation rule** `MaxBillableWeight` (active): `BillableWeight__c > 150` → "Maximal billable weight is 150".
- Compact layout `Rep_Layout`: Name, Status, Type, Description.

### 1.5 Appointment__c ("Appointment") — `objects/Appointment__c/`
A scheduled visit (pickup, delivery, packing or supplies drop) at a customer address, optionally linked to an order and a truck. Name: auto-number `A-{000000}` (same prefix as Article).

| API name | Label | Type | Req | Values / target / formula | Notes |
|---|---|---|---|---|---|
| `Order__c` | Order | Lookup(Order), SetNull, rel `Appointments` | no | | |
| `Customer__c` | Customer | Lookup(User), SetNull, rel `Appointments1` | no | | "used in email alerts in workflow rules"; filled by flow from the order |
| `CustomerAccount__c` | Customer Account | Lookup(Account), SetNull, rel `Appointments` | no | | Same purpose; filled by flow |
| `CustomerName__c` | Customer Name | Formula Text | | `Order__r.Customer__r.FirstName + " " +  Order__r.Customer__r.LastName` | "used in email templates" |
| `Type__c` | Type | Picklist | no | **Delivery (default)**; Packing; Pickup; Supplies | |
| `Status__c` | Status | Picklist | no | **Unconfirmed (default)**; Confirmed; Truck En Route; Completed; Cancelled | |
| `Date__c` | Delivery Date | Date | **yes** | | Label says "Delivery" for every type |
| `Time__c` | Delivery Time | Picklist | no | **9 AM - 11 AM (default)**; 11 AM - 1 PM; 1 PM - 3 PM; 3 PM - 5 PM; 5 PM - 7 PM | Two-hour slots |
| `Region__c` | Region | Picklist | no | North Campus; West Campus; Sorority; Collegetown Apts / Dorms; Other Address; Ithaca College | Controls `Building__c` |
| `Building__c` | Building | Picklist, restricted, global value set `Building`, controlled by `Region__c` | no | see mapping below | |
| `Address1__c` / `Address2__c` | Address 1 / 2 | Text(255) | no | | |
| `RoomNumber__c` | Room/Apt No. | Text(5) | no | | |
| `City__c` | City | Text(40) | no | | |
| `State__c` | State | Picklist | no | US-state list; **New York (default)** | |
| `Zip__c` | Zip | Text(20) | no | | |
| `ElevatorInBuilding__c` | Elevator In Building | Checkbox (false) | | | |
| `PhoneNumber__c` | Phone Number | Phone | **yes** | | |
| `StudentName__c` | Name of Customer | Text(255) | no | | |
| `StudentEmail__c` | Email | Email | no | | |
| `NetID__c` | NetID | Text(20) | no | | Order's NetID is Text(100) |
| `ClassYear__c` | Class Year | Text(10) | no | | |
| `IsCornellStudent__c` | Does customer attend Cornell? | Picklist, restricted | **yes** | **Yes (default)**; No | |
| `EstimatedBoxedItems__c` | Estimated # of boxed items | Picklist, restricted | no | **0 (default)**; 1; 2; 3; 4; 5; 6; 7; 8; 9; 10; 11; 12; 13; 14; 15+ | |
| `EstimatedNonBoxedItems__c` | Estimated # of non-boxed items | Picklist, restricted | no | **0 (default)**; 1 … 14; 15+ (same 16 values) | |
| `EstimatedNumberOfItems__c` | Estimated Number Of Items | Picklist | no | 1-3; 4-7; 8-11 | Looks superseded by the two fields above |
| `PackingEstimate__c` | Estimated Number of Hours | Number(2,0) | no | | |
| `Notes__c` | Notes | TextArea | no | | |
| `Truck__c` | Truck | Lookup(Truck__c), SetNull, rel `Appointments` | no | | Changing it triggers crew copy |
| `Truck_User__c` | Truck User | Lookup(User), SetNull, rel `Appointments` | no | | Help: "The user that represents the truck login" |
| `Field_Rep_1__c` … `Field_Rep_5__c` | Field Rep 1–5 | Lookup(Contact), SetNull, rel `Appointments`, `Appointments1`, `Appointments2`, `Appointments3`, `Appointments4` | no | | Copied from the truck by flow |

`Building__c` values by controlling `Region__c` (72 values; the only place the `Building` set is visible):
- **West Campus (16):** Hans Bethe; Alice H. Cook House; Language House; William Keeton House; McFaddin Hall; Founders Hall; Lyon Hall; North Baker; Baker Tower; Boldt Tower; Boldt Hall; Flora Rose House (Main); Carl Becker House; 118 McGraw; Campus Hill Apartments; Ravenwood Apartments
- **Collegetown Apts / Dorms (17):** 112 Edgemoor; Cascadilla Hall; Sheldon Court; Schuyler House; The Student Agencies Building; 407 College Ave Apartments; 151 Dryden; Eddygate Apartments; Collegetown Crossing; The Lofts; The Lux; Collegetown Townhouses; Collegetown Terrace Apartments; 312 College Ave; Collegetown Court Apartments; Fairview Apartments; Maplewood Apartments
- **Other Address (1):** Other
- **Sorority (12):** Delta Gamma; Kappa Delta; Tri Delta; Pi Phi; Alpha Phi; Kappa Kappa Gamma; Alpha Chi Omega; Alpha Xi Delta; Sigma Delta Tau; Alpha Epsilon Phi; Theta; Phi Sigma Sigma
- **North Campus (26):** Risley; Balch; Clara Dickson / MCLLU; Court; Kay; Baur; Mews; Donlon; Jameson; Toni Morrison; Ganędagǫ:; High Rise #5; Townhouses; Hasbrook Community Center Apartments; Low Rise #6; Low Rise #7; Low Rise #8 / HILC; Low Rise #9 / JAM; Low Rise #10 / Ujamaa; Latino Living Center; Awe:kon; Ecology House; Barbara McClintock Hall; Hu Shih Hall; RBG Hall; Toni Morrison Hall
- **Ithaca College:** no buildings mapped.

No validation rules or record types. List views: `All` (label "Summer 2020", Date > 5/1/2026), `August_2018`, `August_2019_2`, `December_2020`, `Orders_to_Ship`, `Status`, `Today_Future` (Date ≥ TODAY and Status not containing Cancelled).

### 1.6 ApptNonavailability__c ("Appt Nonavailability") — `objects/ApptNonavailability__c/`
Blackout of appointment slots for a date range, optionally limited to buildings. Name: `ANA-{000000}`. Org-wide default Read.

| API name | Label | Type | Req | Values | Notes |
|---|---|---|---|---|---|
| `Date__c` | Start Date | Date | **yes** | | |
| `EndDate__c` | End Date | Date | no | | |
| `Times__c` | Times | Multi-select picklist | no | 9 AM - 11 AM; 11 AM - 1 PM; 1 PM - 3 PM; 3 PM - 5 PM; 5 PM - 7 PM | Same slots as `Appointment__c.Time__c` |
| `AllDay__c` | All Day | Checkbox (false) | | | Trigger keeps it in sync with `Times__c` |
| `Building__c` | Building | Multi-select picklist, restricted, global set `Building` | no | same set as appointments | |

### 1.7 Warehouse__c ("Warehouse") — `objects/Warehouse__c/`
Despite the name, a per-order-line storage-location record (one per Order Product, kept in sync by two flows). Name: `W-{0000}` ("Warehouse Number").

| API name | Label | Type | Req | Target / values |
|---|---|---|---|---|
| `Order_Product__c` | Order Product | Lookup(OrderItem), SetNull, rel `Warehouses` | no | |
| `Warehouse__c` | Warehouse | Picklist, restricted, global set `Warehouses` | no | values not in repo |
| `Location__c` | Location | Text(255) | no | |

### 1.8 Truck__c ("Truck") — `objects/Truck__c/`
A truck with its crew and its shared login user. Name: free text. History on.

| API name | Label | Type | Target |
|---|---|---|---|
| `Truck_User__c` | Truck User | Lookup(User), SetNull, rel `Trucks` | Help: "The user that represents the truck login license" |
| `Field_Rep_1__c` … `Field_Rep_5__c` | Field Rep 1–5 | Lookup(Contact), SetNull, rel `Trucks1` … `Trucks5` | Crew members are Contacts |

### 1.9 Payment__c ("Payment") — `objects/Payment__c/`
A Stripe payment (charge, authorization or zero-amount record) against an order, with a card snapshot and billing address. Name: `P-{0000000}`.

| API name | Label | Type | Req | Values / target | Notes |
|---|---|---|---|---|---|
| `Order__c` | Order | Lookup(Order), SetNull, rel `Payments` | no | | Flow sets owner to the order's customer |
| `Amount__c` | Amount | Currency(18,2) | **yes** | | |
| `AmountDescription__c` | Amount Description | TextArea | no | | |
| `Type__c` | Type | Picklist | no | Authorize; **Charge (default)**; 0-Amount | |
| `StripeId__c` | Stripe Id | Text(50), unique, case-sensitive | no | | |
| `OperationToken__c` | Operation Token | Text(100) | no | | "Used internally to avoid potential duplicates of payments for a particular order" (idempotency key) |
| `CardStripeId__c` | Card Stripe Id | Text(50) | no | | |
| `CardBrand__c` | Card Brand | Picklist | no | American Express; Diners Club; Discover; JCB; MasterCard; Visa; Unknown | |
| `CardName__c` | Card Name | Text(100) | no | | |
| `CardNumberLast4__c` | Card Number Last4 | Text(4) | no | | |
| `CardExpirationMonth__c` / `CardExpirationYear__c` | Card Expiration Month / Year | Number(2,0) / Number(4,0) | no | | |
| `Address1__c`, `Address2__c` | Address 1 / 2 | Text(255) | no | | |
| `City__c` | City | Text(40) | no | | |
| `State__c` | State | Picklist | no | US-state list; **New York (default)** | |
| `Zip__c` | Zip | Text(20) | no | | |
| `Country__c` | Country | Text(100) | no | | |
| `Refunded__c` | Refunded | Checkbox (false) | | | "Indicates if the payment was refunded in Stripe. This is a manual process." |
| `Refund_Amount__c` | Refund Amount | Currency(18,2) | no | | |
| `Refund_Notes__c` | Refund Notes | Text(255) | no | | |

There is no payment *status* field: state is implied by `Type__c` plus the refund fields.

### 1.10 ZipZone__c and ZoneWeight__c — shipping rate tables
`ZipZone__c` (`ZoneRange-{000}`): maps a ZIP-prefix range to a shipping zone. `ZoneWeight__c` (`ZoneWeight-{0000}`): price per zone and weight.

| Object | API name | Label | Type | Req | Notes |
|---|---|---|---|---|---|
| ZipZone__c | `ZipCodeLow__c` | ZipCodeLow | Number(5,0) | no | Apex compares the **first 3 digits** of the ZIP against Low/High (`classes/BRSS_ZipZoneDAO.cls:10,25`) |
| ZipZone__c | `ZipCodeHigh__c` | ZipCodeHigh | Number(5,0) | no | |
| ZipZone__c | `Zone__c` | Zone | Number(2,0) | **yes** | |
| ZoneWeight__c | `Zone__c` | Zone | Number(2,0) | **yes** | Joined to ZipZone by value, no lookup |
| ZoneWeight__c | `Weight__c` | Weight | Number(4,0) | no | Help: "Weight in Pounds" |
| ZoneWeight__c | `ShipToHomePrice__c` | Ship To Home Price | Currency(6,2), default 0 | no | |
| ZoneWeight__c | `ShipToCornellPrice__c` | Ship To Cornell Price | Currency(6,2), default 0 | no | |

### 1.11 BRSS_StorageTermProduct__c — list custom setting (protected)
"This setting defines storage products for terms in months, considering overweight."

| API name | Label | Type | Req |
|---|---|---|---|
| `StorageTermInMonths__c` | Storage Term In Months | Number(2,0) | **yes** |
| `IsOverweight__c` | Is Overweight | Checkbox (false) | |
| `ProductId__c` | Product Id | Text(18) | no — a Product2 Id stored as text |

### 1.12 BRSS_HierarchySettings__c — hierarchy custom setting (protected)
Global configuration. All `*ProductId*` fields are Product2 Ids stored as Text(18). Values are org data and are not in the repo.

| API name | Label | Type | Req | Purpose (from description) |
|---|---|---|---|---|
| `TaxPercentage__c` | Tax Percentage | Percent(18,0) | yes | Tax rate used by `Order.Tax__c` |
| `AuthorizationAmount__c` | Authorization Amount | Currency(7,2), default 1 | yes | Amount used to authorize a card (in dollars, not cents) |
| `MaxDiscountByNonAdmin__c` | Max Discount By Non-Admin | Percent(3,0), default 5 | yes | Max discount a non-admin may apply while processing an order |
| `BlockedNextDaysForAppointment__c` | Blocked Next Days For Appointment | Number(18,0), default 2 | no | Number of upcoming days in which appointments cannot be booked |
| `RegionsWithPrearrival__c` | Regions With Prearrival | TextArea | no | Regions that support pre-arrival delivery, one per line |
| `DefaultAccount__c` | Default Account | Text(18) | yes | Account that holds orders from users without a personal account |
| `AdminPofilesIds__c` (sic) | Admin Profiles Ids | Text(255) | no | Comma-separated profile Ids treated as admin |
| `OWEA_Id_ConfirmationSender__c` | OWEA_Id_ConfirmationSender | Text(18) | yes | Org-wide email address used to send activation-code emails |
| `StripeSecretApiKey__c` | Stripe Secret API Key | Text(100) | yes | Stripe API secret (definition only) |
| `ShipToHomeProductId__c` | Ship To Home Product Id | Text(18) | yes | Product: shipping to home |
| `ShipToCornellProductId__c` | Ship To Cornell Product Id | Text(18) | yes | Product: shipping to Cornell |
| `FlatRateProductId_CornellShipping__c` | Flat Rate ProductId (Cornell Shipping) | Text(18) | yes | Flat rate, shipped on the Cornell account |
| `FlatRateProductId_OtherShipping__c` | Flat Rate ProductId (3rd Party Shipping) | Text(18) | yes | Flat rate, shipped on a 3rd-party account |
| `InsuranceProductId__c` | Insurance Product Id | Text(18) | yes | Product: insurance |
| `OtherNonBoxedProductId__c` | Other Non Boxed Product Id | Text(18) | yes | "Other" non-boxed product for unusual articles |
| `PackingProductId__c` | Packing Product Id | Text(18) | yes | Packing, usual periods |
| `PackingProductId_Peak__c` | Packing Product Id (Peak) | Text(18) | yes | Packing, peak periods |
| `PrearrivalProductId__c` | Prearrival Product Id | Text(18) | yes | Pre-arrival delivery to dorm |

### 1.13 Product2, PricebookEntry, Pricebook2 (standard)
The service/supply catalogue and its prices. Apex defaults an order to the standard price book (`classes/BRSS_OrderUtils.cls:144`).

| Object | Custom fields | Standard fields with a file |
|---|---|---|
| Product2 | `NonBoxedItem__c` (NonBoxed Item, Checkbox, false); `Prearrival__c` (Prearrival, Checkbox, false) | `AvailabilityDate`, `BasedOnId`, `ConfigureDuringSale`, `Description`, `DiscontinuedDate`, `DisplayUrl`, `EndOfLifeDate`, `ExternalDataSourceId`, `ExternalId`, `Family` (picklist, values not in repo), `HelpText`, `IsActive`, `IsAssetizable`, `IsSoldOnlyWithOtherProds`, `Name`, `ProductCode`, `QuantityUnitOfMeasure`, `SpecificationType`, `StockKeepingUnit`, `Type`, `UnitOfMeasureId`, `UsedFor` |
| PricebookEntry | none | `IsActive`, `Pricebook2Id`, `Product2Id`, `ProductCode`, `ProductSellingModelId`, `StandardPrice`, `UnitPrice`, `UseStandardPrice` |
| Pricebook2 | none | `Description`, `IsActive`, `IsStandard`, `Name` |

### 1.14 Employment__c ("Employment") — `objects/Employment__c/`
A job posting shown on the public site. Name = "Position" (text).

| API name | Label | Type |
|---|---|---|
| `Description__c` | Description | Rich text (Html, 32768) |
| `Display_on_Website__c` | Display on Website | Checkbox (false) |

### 1.15 Quote__c ("Quote") and Move__c ("Move") — moving-company objects (see section 7)
`Quote__c` (`Q-{000}`): a moving quote request. `Move__c` (`M-{0000}`, description "A move appointment for HHMC"): a booked move created from a quote. Each has one record type (`Quote_Record`, `Move_Record`). Chatter feeds and history on.

| Object | API name | Label | Type | Req | Notes |
|---|---|---|---|---|---|
| Quote__c | `Customer_Name__c` | Customer Name | Text(100) | **yes** | |
| Quote__c | `Customer_Email__c` | Customer Email | Email | **yes** | |
| Quote__c | `Customer_Phone__c` | Customer Phone | Phone | no | |
| Quote__c | `Residence_Type__c` | Residence Type | Picklist, restricted | **yes** | House; Apartment; Storage Unit; Other |
| Quote__c | `Origin_Address__c` | Origin Address | Text(255) | **yes** | |
| Quote__c | `Origin_City__c`, `Origin_State__c` | Origin City / State | TextArea | no | |
| Quote__c | `Origin_Zip__c` | Origin Zip | Number(5,0) | no | Numeric, so leading zeros are lost |
| Quote__c | `Destination_Address__c`, `Destination_City__c` | Destination Address / City | TextArea | no | |
| Quote__c | `Destination_State__c` | Destination State | Text(255) | no | |
| Quote__c | `Destination_Zip__c` | Destination Zip | Number(18,0) | no | |
| Quote__c | `Desired_Time__c` | Desired Time | DateTime | no | |
| Quote__c | `Bedroom_Number__c`, `Floor_Number__c`, `Boxes_Estimate__c`, `Hours__c` | Bedroom Number / Floor Number / Boxes Estimate / Hours | Number(3,0) | no | |
| Quote__c | `Miles__c` | Miles | Number(7,2) | no | "Distance to Move Origin" |
| Quote__c | `Large_Furniture__c`, `Valuable_Items__c` | Large Furniture / Valuable Items | TextArea | no | Comma-separated lists |
| Quote__c | `Quote_Price__c` | Quote Price | Number(9,2) | **yes** | Number, not Currency |
| Quote__c | `HHMC_Reference__c` | HHMC Reference | TextArea | no | "How did you hear about Hired Hands Moving Company" |
| Move__c | `Final_Quote__c` | Quote | Lookup(Quote__c), **required**, Restrict delete, rel `Moves` | **yes** | |
| Move__c | `Customer_Name__c` | Customer Name | Text(255) | **yes** | |
| Move__c | `Customer_Email__c` | Customer Email | Text(100) | no | |
| Move__c | `Customer__c` | Customer Phone | Phone | no | API name is misleading: it is a phone number |
| Move__c | `Move_Date_Time__c` | Move Date/Time | DateTime | **yes** | |
| Move__c | `Laborers__c` | Laborers | Number(5,0) | **yes** | |
| Move__c | `Labor_type__c` | Labor Type | Picklist, restricted | no | Move; Labor |
| Move__c | `hours__c` | Hours | Number(12,2) | no | "Time estimate in hours" |
| Move__c | `Destination_Address__c` | Destination Address | TextArea | **yes** | |
| Move__c | `Origin_Address__c` | Origin Address | Text(255) | no | |
| Move__c | `Origin_City__c`, `Origin_State__c`, `Destination_City__c`, `Destination_State__c` | | TextArea | no | |
| Move__c | `Origin_Zip__c`, `Destination_Zip__c` | | Number(6,0) | no | |
| Move__c | `Bedroom_Number__c`, `Boxes_Estimate__c` | | Number(3,0) | no | |

`Quote__c` button `Finalize_Quote` ("Finalize Quote") opens a new-record page pre-filled from the quote with a lookup back to the quote (target object identified only by a hard-coded key prefix; presumably Move__c).

### 1.16 fb_Fulfillment__c ("Fishbowl Fulfillment") — `objects/fb_Fulfillment__c/`
A shipment record from a Fishbowl inventory integration, hanging off Opportunities. Name = "Shipment Number" (text). Reports and search disabled.

| API name | Label | Type |
|---|---|---|
| `Opportunity__c` | Opportunity | Lookup(Opportunity), SetNull, rel `fb_order_Fulfillments` |
| `Opportunity_Product__c` | Opportunity Product | Lookup(OpportunityLineItem), SetNull, rel `fb_item_Fulfillments` |
| `Carrier__c`, `Carrier_Service__c`, `Location_Group__c`, `Product_Number__c`, `Tracking_Number__c` | | Text(100) |
| `Date_Shipped__c` | Date Shipped | DateTime |
| `Quantity_Shipped__c` | Quantity Shipped | Number(10,2) |
| `Tracking_Info__c` | Tracking Info | TextArea |

### 1.17 Account, Contact, User — custom fields only
- **Account:** no custom fields (44 field files, all standard). Person-account fields are present (`PersonEmail`, `PersonMailingAddress`, …), so person accounts are enabled. Record types `Business_Account`, `Default`. Button `Send_Field_Rep_Link` ("Sends the link to the internal field rep site").
- **User** (customers are community users; list view `BRSS_Community_Users` filters on profile "BRSS Community User"):

| API name | Type | Values / purpose |
|---|---|---|
| `StripeId__c` | Text(100) | "Id of the customer in Stripe" |
| `College__c` | Picklist | Human Ecology; Engineering; A&S; CALS; Architecture; Hotel; ILR; Graduate School/Program; N/A |
| `Cornell_Affiliation__c` | Picklist | Undergrad; Grad; Alumni; Faculty; N/A |
| `Gender__c` | Picklist | Male; Female; Other; Prefer Not to Say |
| `Graduation_Year__c` | Picklist | 2015 … 2050 (each year), N/A |
| `Referrer__c` | Picklist | Cornell; Facebook; Friend Referral; Google; Returning Customer |
| `Marketing_Opt_Out__c` | Checkbox (false) | Marketing opt-out |

- **Contact** (BRSS-looking fields describe staff/applicants; ten equivalent fields exist on Lead under slightly different API names, and list view `EMPLOYEES` filters on account name "BRSS Employees"):

| API name | Type | Values / purpose |
|---|---|---|
| `College__c` | Picklist | N/A; Human Ecology; Engineering; A&S; CALS; AAP; Hotel; ILR; Ithaca College; Graduate Program |
| `Gender__c` | Picklist | N/A; Male; Female; Other |
| `Graduation_Year__c` | Text(4) | Graduation year |
| `Has_Driver_License__c`, `Has_Smartphone__c` | Checkbox | Applicant capabilities |
| `Driver_s_License_Number__c` | Text(15) | Licence number |
| `Last_Date_Available_to_Work__c` | Date | Availability end |
| `Number_of_Finals__c` | Number(2,0) | Exam load |
| `Number_of_Locations__c` | Number(3,0) | Not described |
| `On_Campus_Group__c` | Text(100) | Campus group |
| `GW_Volunteers__*` (12 fields) | managed package | Volunteers for Salesforce package; `GW_Volunteers__Volunteer_Skills__c` values are Driver; Field Rep, and `…Volunteer_Availability__c` uses the same five 2-hour slots per weekday |

Contact buttons: `Send_Field_Rep_Link` ("Send BRSS Field Rep Link"), `Send_HHMC_Mover_Link`.

---

## 2. Entity-relationship summary

Child → parent (cardinality is many-to-one unless noted):

- `Order` → `Account` via standard `AccountId` (platform-required; sharing controlled by the account). Apex falls back to `BRSS_HierarchySettings__c.DefaultAccount__c` when the customer has no account (`classes/BRSS_OrderUtils.cls:10-19`).
- `Order` → `User` via `Customer__c` (lookup, SetNull; mandatory through validation rule; also copied to `OwnerId`).
- `Order` → `Pricebook2` via standard `Pricebook2Id`.
- `Order` → `Contract`, `Opportunity`, `Order` (`OriginalOrderId`), `Contact` (`BillToContactId`, `ShipToContactId`), `User` (`ActivatedById`, `CompanyAuthorizedById`) — standard lookups with field files; no BRSS automation touches them.
- `OrderItem` → `Order` via standard `OrderId` (platform master-detail; lines are deleted with the order).
- `OrderItem` → `Product2` (`Product2Id`) and → `PricebookEntry` (standard).
- `OrderItem` → `Article__c` via `Article__c` (lookup, SetNull, optional).
- `PricebookEntry` → `Pricebook2`, → `Product2` (standard).
- `OrderArticle__c` → `Order` via `Order__c` (**master-detail**, primary, cascade delete, not reparentable).
- `OrderArticle__c` → `Article__c` via `Article__c` (**master-detail**, secondary, cascade delete, not reparentable). Together: `Order` ⟷ `Article__c` is **many-to-many**.
- `Article__c` → `User` via `Customer__c` (lookup, SetNull); → `Product2` via `Product__c` (lookup, SetNull).
- `Appointment__c` → `Order` via `Order__c` (lookup, SetNull, optional; an order can have many appointments).
- `Appointment__c` → `Account` (`CustomerAccount__c`), → `User` (`Customer__c`, `Truck_User__c`), → `Truck__c` (`Truck__c`), → `Contact` ×5 (`Field_Rep_1__c`…`5`). All lookups, SetNull.
- `Truck__c` → `User` (`Truck_User__c`), → `Contact` ×5 (`Field_Rep_1__c`…`5`). Lookups, SetNull.
- `Payment__c` → `Order` via `Order__c` (lookup, SetNull, optional).
- `Warehouse__c` → `OrderItem` via `Order_Product__c` (lookup, SetNull). Declared many-to-one, but flows maintain it as **one-to-one** (find-or-create per line).
- `Move__c` → `Quote__c` via `Final_Quote__c` (lookup, required, **Restrict** delete).
- `fb_Fulfillment__c` → `Opportunity`, → `OpportunityLineItem` (lookups, SetNull).
- `User` → `Contact`/`Account` (standard community-user link; Apex reads `customer.AccountId`).

Soft references (no foreign key):
- `Order.ShipHomeZone__c` = `ZipZone__c.Zone__c` = `ZoneWeight__c.Zone__c` (numeric match; zone found by first 3 ZIP digits).
- `BRSS_StorageTermProduct__c.ProductId__c` and every `BRSS_HierarchySettings__c.*ProductId*` → `Product2` Id as text; `DefaultAccount__c` → Account Id; `AdminPofilesIds__c` → Profile Ids; `OWEA_Id_ConfirmationSender__c` → org-wide email address Id.
- `Appointment__c.Building__c` and `ApptNonavailability__c.Building__c` share the `Building` value set (blackouts match appointments by value, not by key).
- `ApptNonavailability__c`, `ZipZone__c`, `ZoneWeight__c`, `Employment__c` have no relationships.

---

## 3. Status and lifecycle picklists (full)

| Field | Values in order | Default | File |
|---|---|---|---|
| `Order.Status` (standard) | Activated; Cancelled; Closed; NonActivated; Open (as enabled on record types; master order unknown) | none in repo; Apex creates orders as `Open` | `objects/Order/recordTypes/Default.recordType-meta.xml`, `…/Express.recordType-meta.xml`; constants at `classes/BRSS_OrderDAO.cls:20-23` |
| `Order.Type__c` (multi-select) | Packing; Ship to Cornell; Ship to Home; Storage; Supplies | none | `objects/Order/fields/Type__c.field-meta.xml` |
| `Order.Type` (standard) | Packing; Storage; Supplies (as enabled on record types) | none | `objects/Order/recordTypes/*.recordType-meta.xml` |
| `Order.Master_Article_Status__c` | Delivered; In Warehouse; On Truck, to delivery; Ready for Delivery; Ready for Shipment; Shipped; Stored; On Truck, to warehouse | none | `objects/Order/fields/Master_Article_Status__c.field-meta.xml` |
| `Order.Campus_Category__c` | On-Campus; Off-Campus; Counter | none | `objects/Order/fields/Campus_Category__c.field-meta.xml` |
| `OrderItem.Status__c` | New; Paid | New | `objects/OrderItem/fields/Status__c.field-meta.xml` |
| `Article__c.Status__c` | Delivered; In Warehouse; On Truck, to delivery; Ready for Delivery; Ready for Shipment; Shipped; Stored; On Truck, to warehouse | none | `objects/Article__c/fields/Status__c.field-meta.xml` |
| `Article__c.Type__c` | Non-boxed Item; Standard Box; Flat Rate Box | Non-boxed Item | `objects/Article__c/fields/Type__c.field-meta.xml` |
| `Appointment__c.Status__c` | Unconfirmed; Confirmed; Truck En Route; Completed; Cancelled | Unconfirmed | `objects/Appointment__c/fields/Status__c.field-meta.xml` |
| `Appointment__c.Type__c` | Delivery; Packing; Pickup; Supplies | Delivery | `objects/Appointment__c/fields/Type__c.field-meta.xml` |
| `Appointment__c.Time__c` | 9 AM - 11 AM; 11 AM - 1 PM; 1 PM - 3 PM; 3 PM - 5 PM; 5 PM - 7 PM | 9 AM - 11 AM | `objects/Appointment__c/fields/Time__c.field-meta.xml` |
| `Payment__c.Type__c` | Authorize; Charge; 0-Amount | Charge | `objects/Payment__c/fields/Type__c.field-meta.xml` |
| `Payment__c.Refunded__c` (checkbox, acts as status) | false / true | false | `objects/Payment__c/fields/Refunded__c.field-meta.xml` |
| `Move__c.Labor_type__c` | Move; Labor | none | `objects/Move__c/fields/Labor_type__c.field-meta.xml` |
| `Contact.GW_Volunteers__Volunteer_Status__c` | Active; Inactive; New Sign Up; Prospective | none | `objects/Contact/fields/GW_Volunteers__Volunteer_Status__c.field-meta.xml` |

`OrderArticle__c.Master_Article_Status__c` and `OrderArticle__c.Order_Status__c` are free-text copies of the two Order statuses, not picklists. The article status values are not in a logical lifecycle order in the file.

---

## 4. Flows — `flows/`

Process type `Workflow` = a Process Builder process (runs after save). "Create or edit" = `TriggerType onAllChanges`.

| # | Flow (file) | Status | Trigger | Entry conditions | What it does (key line numbers) |
|---|---|---|---|---|---|
| 1 | `Appointment_Sync_NetID_to_Order.flow-meta.xml` | Active (114) | `Appointment__c`, after save, create and update (101-113) | `OR(ISNEW(), ISCHANGED(NetID__c))` (107-109) | `Get_NetId` (48-79): newest appointment on the same order with a non-null NetID → `varNetId`. `Check_NetId` (4-25): if not null → `Update_Order` (80-100): set `Order.NetID__c` when different. |
| 2 | `Appointment_Trigger_After_Save.flow-meta.xml` | Active (268) | `Appointment__c`, after save, **create only** (258-267) | none at start; `Check_Order_Campus_Category` (180-208): order present and `Order.Campus_Category__c` is null | `Check_Category_Value` (36-179), **OR** logic: Building is one of 15 named apartment buildings (49-152), or Region = "Other Address" (154-158), or Region ≠ "North Campus" (160-165), or both blank (formula 211-215) → `Set_Off_Campus` (4-19); otherwise `Set_On_Campus` (20-35). Then `Update_Order_Campus_Category` (237-257). |
| 3 | `BRSS_ArticleOwnership.flow-meta.xml` | Active (151) | Process on `Article__c`, create or edit (74-79) | `Customer__c != null && OwnerId != Customer__c` (43-53) | `myRule_1_A1` (81-149): set `Article__c.OwnerId = Customer__c`. |
| 4 | `BRSS_MasterArticleStatus.flow-meta.xml` | Active (196) | Process on `Order`, create or edit (119-124) | `Master_Article_Status__c` changed on update (20-51, 52-97); does not fire on insert | `myRule_1_A1` (126-194): update every `OrderArticle__c` of the order, `Master_Article_Status__c` = order value (188-191). Step 1 of 2 (description, 98). |
| 5 | `BRSS_MasterArticleStatusStep2.flow-meta.xml` | Active (196) | Process on `OrderArticle__c`, create or edit (119-124) | `Master_Article_Status__c` changed on update (20-51) | `myRule_1_A1` (126-194): set the linked `Article__c.Status__c` = `OrderArticle__c.Master_Article_Status__c`. Step 2 of 2. |
| 6 | `BRSS_PaymentOwnership.flow-meta.xml` | Active (151) | Process on `Payment__c`, create or edit (74-79) | `Order__c != null && Order__c.Customer__c != null && OwnerId != Order__c.Customer__c` (43-53) | `myRule_1_A1` (81-149): set `Payment__c.OwnerId = Order__r.Customer__c` (145). |
| 7 | `BRSS_Prearrival.flow-meta.xml` | Active (164) | Process on `OrderItem`, **create only** (87-92) | `PricebookEntry.Product2.Prearrival__c = true` (54-58) | `myRule_1_A1` (94-162): set `Order.Prearrival__c = true` (156-159). Never unsets it. |
| 8 | `BRSS_RegionToCampus.flow-meta.xml` | **Draft** (214) | Process on `Appointment__c`, create or edit (137-142) | `Order__c` not null and `Order.Campus_Category__c` null (32-95) | Would set `Order.Campus_Category__c` (144-212) to On-Campus when Region is "North Campus Freshmen Housing" or "West Campus Upperclassman Housing", else Off-Campus (formula 97-116). Those region values no longer exist. Replaced by flow 2. |
| 9 | `BRSS_StorageEffectiveDateAppointment.flow-meta.xml` | Active (269); description says "Currently not being used because of the payment process." (128) | Process on `Appointment__c`, create or edit (149-154) | Type = Pickup, Status = Completed, `Order.Type__c` contains "Storage" (26-126) | `myRule_1_A1` (156-267): if `Order.Storage_Effective_Date__c` is null (230-234), set it to the appointment `Date__c` (261-264). |
| 10 | `BRSS_StorageEffectiveDatePayment.flow-meta.xml` | Active (238) | Process on `Payment__c`, create or edit (118-123) | `Type__c` = Charge and `Order.Type__c` contains "Storage" (26-95) | `myRule_1_A1` (125-236): if `Order.Storage_Effective_Date__c` is null (199-203), set it to the payment `CreatedDate` (230-233). |
| 11 | `BRSS_TruckFieldRepUpdate.flow-meta.xml` | Active (345) | Process on `Appointment__c`, create or edit (118-123) | `Truck__c` changed on update (20-51, 52-97); does not fire on insert | `myRule_1_A1` (125-343): copy `Truck.Field_Rep_1..5__c` to the appointment (187-310) and set appointment `OwnerId = Truck.Truck_User__c` (337-340). |
| 12 | `BRSS_UpdateArticleStatusDelivered.flow-meta.xml` | Active (164) | Process on `OrderArticle__c`, create or edit (87-92) | `Order_Status__c` = "Closed" (54-58) | `myRule_1_A1` (94-162): set linked `Article__c.Status__c` = "Delivered" (156-159). |
| 13 | `BRSS_UpdateCustomerAccount.flow-meta.xml` | Active (187) | Process on `Appointment__c`, **create only** (80-85) | `Order__c != null` (49-59) | `myRule_1_A1` (87-185): `CustomerAccount__c = Order.AccountId` (149-152), `Customer__c = Order.Customer__c` (179-182). |
| 14 | `BRSS_Update_Order_Article_Status.flow-meta.xml` | Active (164) | Process on `Order`, create or edit (87-92) | `Status` = "Closed" (54-58) | `myRule_1_A1` (94-162): set `Order_Status__c` = order status on every `OrderArticle__c` of the order (156-159). Feeds flow 12. |
| 15 | `BRSS_Update_Order_Owner.flow-meta.xml` | **Obsolete** (170) | Process on `Order`, create only (93-98) | `OwnerId != Customer__r.Id` (60-64) | Would set `OwnerId = Customer` (100-168). The Apex trigger does this now. |
| 16 | `Order_Product_Sync_Warehouse_Location.flow-meta.xml` | Active (161) | `OrderItem`, after save, create and update (146-160) | `OR(ISNEW(), ISCHANGED(Warehouse__c), ISCHANGED(Location__c))` (152-156) | `Get_Warehouse` (96-118): find `Warehouse__c` for this line. `Check_Warehouse` (4-47): none → `Create_Warehouse` (70-95) copying Warehouse and Location; differs → `Update_Warehouse` (119-145). A `Warehouse__c` row is created for every new order line, even with blank values. |
| 17 | `Warehouse_Sync_Order_Product_Warehouse_Location.flow-meta.xml` | Active (59) | `Warehouse__c`, after save, **update only** (45-58) | Warehouse or Location changed and differs from the order line (51-54) | `Update_Order_Product` (26-44): copy Location and Warehouse back to the `OrderItem`. |
| 18 | `correct_zeroes.flow-meta.xml` | **Draft** (91) | Screen flow, run manually (31, 76-90) | none | `zeroprice` (32-54) reads a `ShipToHomePrice__c` from one `ZoneWeight__c` with blank Cornell price; `Update_Ship_price` (55-75) writes that single value to every `ZoneWeight__c` whose `ShipToCornellPrice__c` = 0. One-off data fix. |

Chains worth preserving in a rewrite:
- **Bulk status:** edit `Order.Master_Article_Status__c` → flow 4 → flow 5 → every article's `Status__c`.
- **Close order:** `Order.Status` = Closed → flow 14 → flow 12 → every article `Delivered`.
- **Location placed:** any of pallet/row/section/warehouse set on an article → workflow field update → `Status__c` = Stored (section 5).
- **Storage clock:** first Charge payment on a storage order (flow 10) or a completed Pickup appointment (flow 9), whichever comes first, sets `Storage_Effective_Date__c` once.

---

## 5. Workflow rules, field updates, email alerts — `workflows/`

Recipient "customer" = the user in `Customer__c`. "BRSS mailbox user" = a named internal user (address not copied).

| Object (file) | Rule (line) | Active | Criteria | Evaluated | Action |
|---|---|---|---|---|---|
| Appointment__c (`Appointment__c.workflow-meta.xml`) | BRSS Changed/Cancelled Appointment (115) | no | `AND(LastModifiedById == OwnerId, OR(ISCHANGED(Date__c), ISCHANGED(Time__c), ISCHANGED(Status__c), ISCHANGED(Notes__c)))` | every change | Alert `Changed_Cancelled_Appointment` → BRSS mailbox user; template `BRSS_Templates/Cancelled_Changed_Appointment` |
| | BRSS Today's Appointments (126) | yes | `Date__c` = TODAY | create / when newly true | **no actions** |
| | Customer Delivery Confirmation (138) | yes | Status = Confirmed, Type = Delivery | create / newly true | Alert `Customer_DeliveryConfirmation` → customer + BRSS mailbox user; `Customer_Emails/Customer_DeliveryConfirmation` |
| | Customer Delivery Reminder (158) | yes | Status = Confirmed, Type = Delivery, Date = TOMORROW | create / newly true | Alert `Customer_DeliveryReminder`; `Customer_Emails/Customer_DeliveryReminder` |
| | Customer Pickup Confirmation (183) | yes | Status = Confirmed, Type = Pickup | create / newly true | Alert `Customer_PickupConfirmation`; `Customer_Emails/Customer_PickupConfirmation` |
| | Customer Pickup Reminder (203) | yes | Status = Confirmed, Type = Pickup, Date = TOMORROW | create / newly true | Alert `Customer_PickupReminder`; `Customer_Emails/Customer_PickupReminder` |
| | Customer Supplies Delivery Confirmation (228) | yes | Type = Supplies, Status = Confirmed | create / newly true | Alert `Customer_SuppliesDeliveryConfirmation`; `Customer_Emails/Customer_SuppliesConfirmation` |
| | Customer Supplies Reminder (248) | yes | Status = Confirmed, Type = Supplies, Date = TOMORROW | create / newly true | Alert `Customer_SuppliesReminder`; `Customer_Emails/Customer_SuppliesReminder` |
| | Email Alert: Customer Appointment (273) | no | Status = Confirmed | create / newly true | Time trigger 2 days before `Date__c`, no actions |
| | Email Alert: Customer Delivery Reminder (289) | no | Status = Confirmed, Date = TOMORROW, Type = Delivery | create / newly true | Alert `Delivery_24hr_Reminder` → customer |
| Order (`Order.workflow-meta.xml`) | BRSS Cancelled Order (142) | no | Status = Cancelled | create / newly true | Alert `BRSS_CancelledOrder` → account owner |
| | BRSS Ship to Cornell (156) | yes | `Type__c` includes "Ship to Cornell" | create / newly true | Alert `BRSS_ShipToCornell` → account owner; `BRSS_Templates/BRSS_ShipToCornell` |
| | BRSS Shipping Request (170) | yes | Status = Open, `Type__c` includes "Ship to Home" | create / newly true | Alert `Customer_Request_to_Ship` → BRSS mailbox user only; `BRSS_Templates/BRSS_Customer_Shipping_Request` |
| | BRSS Storage Term Ending (190) | no | `StorageDeliveryScheduled__c` = False, `Days_Until_Delivery__c` = 30 | create / newly true | Alert `BRSS_StorageTermEnding` → customer |
| | Customer Order Receipt (209) | yes | `OrderTotal__c` > 0, Status = Open | **create only** | Alert `Customer_OrderReceipt` → customer + BRSS mailbox user; `Customer_Emails/Customer_OrderReceipt` |
| | Customer Order Request (229) | yes | CreatedDate = TODAY, `Type__c` equals "Ship to Cornell,Ship to Home,Storage" | create / newly true | Alert `Customer_OrderRequest` → customer + BRSS mailbox user; `Customer_Emails/Customer_OrderRequest` |
| | Delivery Past Due (249) | no | `Days_Until_Delivery__c` ≤ -1 | create / newly true | Alert `Delivery_Past_Due` → customer + BRSS mailbox user |
| | Email Alert: Customer Order (264) | no | `OrderTotal__c` > 0, Status = Open | create only | Alert `Customer_OrderConfirmation` |
| | NewRuleExample (284) | no | `Type__c` = Supplies | create / newly true | none |
| | Schedule Delivery Reminder (294) | yes | `Days_Until_Delivery__c` = 20 | create / newly true | Time trigger 20 days before `StorageDeliveryBy__c` → alert `Schedule_Delivery_Appointment_Soon` → customer; `BRSS_Templates/BRSS_StorageTermEnding` |
| Article__c (`Article__c.workflow-meta.xml`) | BRSS Update Article Status (14) | yes | `Pallet_Number__c` or `Row__c` or `Section__c` or `Warehouse__c` not blank (`1 OR 2 OR 3 OR 4`) | create / newly true | **Field update** `BRSS_UpdateStatusToStored` (3): `Status__c` = Stored |
| OrderArticle__c (`OrderArticle__c.workflow-meta.xml`) | BRSS Box Greater than 70 (14) | yes | `Article__c.Weight__c` > 70 | create / newly true | Alert `BRSS_BoxExceeds70Ibs` → account owner, plus a cc address; `BRSS_Templates/BRSS_BoxGreaterThan70` |
| Payment__c (`Payment__c.workflow-meta.xml`) | Peak Fee (18) | no | `Amount__c` = 21.60 | create / newly true | Alert `Peak_Fee_charge_after_fact` → owner + last modifier; `unfiled$public/BRSS_Peak_Fee` |
| Case (`Case.workflow-meta.xml`) | BRSS Managers Case Received (15) | yes | Status = New, Working | create / newly true | Alert `BRSS_Managers_Case_Received` → BRSS mailbox user |
| Lead (`Lead.workflow-meta.xml`) | BRSS New Employment Application (34) | yes | CreatedDate = TODAY | create only | Alert `BRSS_NewEmploymentApplication` → lead owner |
| Lead | GW_Volunteers__Volunteer Signup - Lead (48) | no | Volunteer status = New Sign Up | create only | 2 alerts + task (managed package) |
| Contact (`Contact.workflow-meta.xml`) | GW_Volunteers__Volunteer Signup - Contact (24) | no | `GW_Volunteers__Volunteer_Last_Web_Signup_Date__c = TODAY()` | create / newly true | 2 alerts + task (managed package) |

Alerts defined on Order but attached to no rule in the file: `BRSS_PeakFee` (13), `Schedule_Delivery_Appointment` (118). No other metadata in flows, classes or triggers references them. The only field update in the org's workflows is `BRSS_UpdateStatusToStored`.

---

## 6. Triggers — `triggers/`

| Trigger | Object / events | Calls | Effect |
|---|---|---|---|
| `BRSS_OrderBgJobs.trigger` (API 58.0, Active) | `Order` — before insert, before update (`:5`) | `BRSS_OrderUtils.setOwner_BeforeUpsert(Trigger.new)` at `:12` (insert and update) | If `Customer__c` is set and differs from `OwnerId`, owner := customer (`classes/BRSS_OrderUtils.cls:173`) |
| | | `BRSS_OrderUtils.setPricebook_BeforeInsert(Trigger.new)` at `:21` (insert) | Orders without a price book get the standard price book (`classes/BRSS_OrderUtils.cls:144`) |
| | | `BRSS_OrderZipZoneUtils.setZipZones_BeforeInsert(Trigger.new)` at `:30` (insert) | If `ShipHomeZip__c` is set and zone is blank, look up zone (`classes/BRSS_OrderZipZoneUtils.cls:73`) |
| | | `BRSS_OrderZipZoneUtils.setZipZones_BeforeUpdate(Trigger.new, Trigger.oldMap)` at `:34` (update) | Recompute `ShipHomeZone__c` when the ZIP changes (`classes/BRSS_OrderZipZoneUtils.cls:93`); only numeric ZIPs are processed (`:29`) |
| `BRSS_ApptNonavailabilityBgJobs.trigger` (API 58.0, Active) | `ApptNonavailability__c` — before insert, before update (`:5`) | `BRSS_ApptNonavailabilityUtils.syncTimesAndAllDayFlag_BeforeInsert(Trigger.new)` at `:14` | When `AllDay__c` is false, set it to true if every time slot is selected (`classes/BRSS_ApptNonavailabilityUtils.cls:36`) |
| | | `BRSS_ApptNonavailabilityUtils.syncTimesAndAllDayFlag_BeforeUpdate(Trigger.new, Trigger.oldMap)` at `:18` | When the user did not change `AllDay__c`, recompute it from `Times__c` (`classes/BRSS_ApptNonavailabilityUtils.cls:59`) |

There are no triggers on Article, OrderArticle, Appointment, Payment or OrderItem; their automation is all flows and workflow rules.

---

## 7. Which business owns what

| Object / fields | Verdict | Evidence |
|---|---|---|
| `Order`, `OrderItem` custom fields, `OrderArticle__c`, `Article__c`, `Appointment__c`, `ApptNonavailability__c`, `Truck__c`, `Payment__c`, `ZipZone__c`, `ZoneWeight__c` | BRSS | Used by `BRSS_*` Apex classes, the two `BRSS_*` triggers, `BRSS_*` flows, workflow alerts using `BRSS_Templates/*`; Cornell-specific fields and values (NetID, dorm buildings, "Ship to Cornell"); `docs/features/prearrival-intake.md` describes them as BRSS records. |
| `BRSS_HierarchySettings__c`, `BRSS_StorageTermProduct__c` | BRSS | `BRSS_` prefix; descriptions reference storage, Cornell shipping, pre-arrival. |
| `Warehouse__c` | BRSS | Linked to Order Products; maintained by the two "Sync Warehouse Location" flows; manifest comment names that flow as BRSS automation (`manifest/package.xml`). No Apex reference. |
| `Product2`, `PricebookEntry`, `Pricebook2` | BRSS (no evidence of other users) | Custom fields `Prearrival__c`, `NonBoxedItem__c` are BRSS concepts; flow `BRSS_Prearrival` and the BRSS settings' product-Id fields point at them. |
| `User` custom fields | BRSS | `StripeId__c`, Cornell affiliation/college, list view on profile "BRSS Community User". |
| `Contact` non-package custom fields | BRSS staff/applicants | Mirror the Lead fields behind the "BRSS New Employment Application" rule; list view filters on account "BRSS Employees"; field reps on trucks and appointments are Contacts. Name-grep finds no Apex/VF use of 7 of them. |
| `Contact.GW_Volunteers__*` | Third-party managed package | `GW_Volunteers__` namespace; picklists customised with "Driver; Field Rep" and BRSS time slots, so BRSS may have used it for shift scheduling (not provable from metadata). |
| `Quote__c` | HHMC | Field `HHMC_Reference__c` described as "How did you hear about Hired Hands Moving Company"; only code reference is `classes/HHMC_NewQuoteExtension.cls`; pages `pages/HHMC_QuoteRequest.page`, `pages/HHMC_QuoteRecieved.page`. No `BRSS_*` class references it. |
| `Move__c` | HHMC | Object description "A move appointment for HHMC"; required lookup to `Quote__c`; no Apex reference; profiles "HHMC Profile" and "HHMC Community User" exist. |
| `Employment__c` | Shared | Queried by both `classes/BRSS_EmploymentsController.cls:47-53` and `classes/HHMC_EmploymentsController.cls:42-48` with the same filter (`Display_on_Website__c = true`); no field distinguishes the business. |
| `fb_Fulfillment__c` | Neither (unused third-party leftover) | Label "Fishbowl Fulfillment"; lookups to Opportunity and Opportunity Product, which BRSS automation never uses; no reference in any class, page, flow or workflow; reports and search disabled. |
| `Account` | Shared platform object | No custom fields. BRSS uses it as the order parent and for sharing. |

Out of scope but present in `objects/`: `About_Us__c`, `FAQ__c`, `BRSS_ReCaptcha_Settings__c`, `Case`, `Lead`.

---

## 8. Open questions and ambiguities

1. **Campus category logic.** In `Appointment_Trigger_After_Save` the Off-Campus rule is an OR that includes "Region ≠ North Campus" (lines 160-165), so every West Campus appointment (and Cascadilla, Sheldon Court, Schuyler, 112 Edgemoor) is classed Off-Campus. The 15-building list becomes redundant. Intended, or a logic error? It runs only on appointment creation and only if the order's category is empty; nothing sets "Counter".
2. **Master picklist values missing.** `Order.Status` master order and default, `Product2.Family`, and the global sets `Warehouses` and `Building` are not in the repo. `Warehouses` values are unknown (Article uses Mecklenburg/Lansing; Order notes add Overflow/SAI Basement). Is `NonActivated` a real status in use? Apex only names Open, Closed, Cancelled, Activated.
3. **Two order type fields.** Standard `Order.Type` (Packing/Storage/Supplies) and multi-select `Type__c` (5 values). Apex and automation use `Type__c`; one list view filters on standard `Type`. Is standard `Type` still populated?
4. **Appointment statuses with no automation.** "Truck En Route" has no rule or flow. Apex constants exist only for Unconfirmed, Completed, Cancelled; who sets "Confirmed" (which drives all customer emails)?
5. **Storage effective date.** Two active flows set it (payment charge date vs completed pickup date); the appointment one is described as "not being used" yet is Active. Which event is the business rule?
6. **Two expiry formulas.** `Storage_Expiration_Date__c` (`ADDMONTHS`) and `StorageDeliveryBy__c` (hand-rolled) can differ on month-end dates. Which one is authoritative? What sets `StorageTermInMonths__c` and `StorageDeliveryScheduled__c` is not in the scoped metadata.
7. **Reminder emails.** Rules such as "Date = TOMORROW" and "Days_Until_Delivery = 20" are only evaluated when a record is saved; the time-based rule depends on the record being edited on the exact day. The manifest mentions a "configured but never arrives" email question. Which reminders are actually expected to go out?
8. **"Customer Order Request" criteria** compares a multi-select with `equals "Ship to Cornell,Ship to Home,Storage"`. Whether this matches combined selections (e.g. Storage + Packing) needs testing against real orders.
9. **Article → order cardinality.** The junction allows an article on many orders. Is that used (e.g. a storage order then a ship-home order for the same box), or is it effectively one order per article? `OrderItem.Article__c` adds a second, optional link between a line and an article.
10. **`Warehouse__c` object vs article location fields.** Location is modelled three ways: `Article__c` (Warehouse/Section/Row/Pallet), `OrderItem`+`Warehouse__c` object (Warehouse/Location), and `Order` (Order Location, Warehouse Notes). Which is the live one?
11. **Fields with no reference in non-test Apex, pages, components, flows or workflows** (name search, approximate): Order `Counter__c`, `Large_Items__c`, `Order_Location__c`, `Tax__c`, `Warehouse_Notes__c`; OrderItem `Article_Description__c`; Appointment `CustomerName__c`, `EstimatedNumberOfItems__c`; Payment `Refunded__c`, `Refund_Amount__c`, `Refund_Notes__c`; settings `PackingProductId__c`, `PackingProductId_Peak__c`. They may still be used on layouts, reports or email templates, none of which are in the repo.
12. **Units.** Article weight and dimensions carry no unit; the 139 divisor and the "70 lbs" alert imply pounds and inches.
13. **NetID.** Order holds Text(100), appointment Text(20); the sync flow copies from the most recently created appointment with a NetID on the order, not necessarily the edited one.
14. **Customer identity.** Customers are `User` records (community users). Appointments also store free-text name, email, phone and NetID, and orders can sit under a shared default account. Which is the source of truth for a customer profile?
15. **`Finalize_Quote` button target** and whether HHMC objects need to be carried into the rewrite at all.
16. **ZIP zones.** `ZipCodeLow/High` are Number(5,0) but compared with 3-digit prefixes; non-numeric ZIPs silently get no zone.
17. **Pre-arrival.** The doc is a draft spec and itself says the described behaviour is "not yet checked against real orders".

---

## 9. Sensitive items seen (paths only)

- Email addresses of internal mailboxes/users in alerts: `workflows/Order.workflow-meta.xml`, `workflows/Appointment__c.workflow-meta.xml`, `workflows/Case.workflow-meta.xml`, `workflows/Payment__c.workflow-meta.xml`, `workflows/OrderArticle__c.workflow-meta.xml`
- Personal name in source header comments: `triggers/BRSS_OrderBgJobs.trigger`, `triggers/BRSS_ApptNonavailabilityBgJobs.trigger`, `classes/BRSS_OrderUtils.cls`, `classes/BRSS_OrderZipZoneUtils.cls` (likely other classes too)
- Hard-coded org record/field Ids: `objects/Quote__c/webLinks/Finalize_Quote.webLink-meta.xml`, `objects/Account/webLinks/Send_Field_Rep_Link.webLink-meta.xml`, `objects/Contact/webLinks/Send_Field_Rep_Link.webLink-meta.xml`, `objects/Contact/webLinks/Send_HHMC_Mover_Link.webLink-meta.xml`
- Definition of a field that stores a payment-provider secret key (no value in metadata): `objects/BRSS_HierarchySettings__c/fields/StripeSecretApiKey__c.field-meta.xml`
- Schema for card and payment-provider identifiers and billing addresses (definitions only): `objects/Payment__c/fields/` (card and Stripe fields), `objects/User/fields/StripeId__c.field-meta.xml`
- Schema for a government ID number (definition only): `objects/Contact/fields/Driver_s_License_Number__c.field-meta.xml`

No live credential values were seen in the scoped metadata. A search of the repo for common key formats (Stripe-style key prefixes, AWS key Ids, private-key headers) matched only the pattern list inside `scripts/scan-for-secrets.sh`.
