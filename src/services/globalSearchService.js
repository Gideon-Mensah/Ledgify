import { accountingApiService } from "./accountingApiService";
import { contactApiService } from "./contactApiService";
import { fixedAssetApiService } from "./fixedAssetApiService";
import { inventoryService } from "./inventoryService";
import { manufacturingService } from "./manufacturingService";
import { purchasesApiService } from "./purchasesApiService";
import { salesApiService } from "./salesApiService";

const includes = (query, ...values) => values.some((value) => String(value || "").toLowerCase().includes(query));
const limit = (rows, query, fields) => (Array.isArray(rows) ? rows : []).filter((row) => includes(query, ...fields(row))).slice(0, 5);

export async function globalSearch(searchTerm) {
  const query = searchTerm.trim().toLowerCase();
  if (query.length < 2) return [];
  const requests = await Promise.allSettled([
    contactApiService.customers(), contactApiService.suppliers(), salesApiService.list(`search=${encodeURIComponent(searchTerm)}`),
    purchasesApiService.list(`search=${encodeURIComponent(searchTerm)}`), accountingApiService.accounts({ search: searchTerm }),
    inventoryService.products({ search: searchTerm }), fixedAssetApiService.assets(), manufacturingService.orders({ search: searchTerm }),
  ]);
  const value = (index) => requests[index].status === "fulfilled" ? requests[index].value : [];
  return [
    { label: "Customers", items: limit(value(0), query, (x) => [x.name, x.email, x.contactNumber]).map((x) => ({ id: x.id, title: x.name, detail: x.email || x.contactNumber, type: "Customer", path: `/contacts/customers/${x.id}` })) },
    { label: "Suppliers", items: limit(value(1), query, (x) => [x.name, x.email, x.contactNumber]).map((x) => ({ id: x.id, title: x.name, detail: x.email || x.contactNumber, type: "Supplier", path: "/contacts/suppliers" })) },
    { label: "Invoices", items: limit(value(2), query, (x) => [x.invoiceNumber, x.customer, x.reference]).map((x) => ({ id: x.id, title: x.invoiceNumber, detail: x.customer, type: "Invoice", path: "/sales/invoices" })) },
    { label: "Bills", items: limit(value(3), query, (x) => [x.billNumber, x.supplier, x.supplierReference]).map((x) => ({ id: x.id, title: x.billNumber, detail: x.supplier, type: "Bill", path: "/purchases/bills" })) },
    { label: "Accounts", items: limit(value(4), query, (x) => [x.code, x.name]).map((x) => ({ id: x.id, title: `${x.code} · ${x.name}`, detail: x.account_class?.replaceAll("_", " "), type: "Account", path: `/accounting/accounts/${x.id}` })) },
    { label: "Products", items: limit(value(5), query, (x) => [x.code, x.sku, x.name]).map((x) => ({ id: x.id, title: `${x.code || x.sku || ""} · ${x.name}`.replace(/^ · /, ""), detail: x.description, type: "Product", path: `/inventory/products/${x.id}` })) },
    { label: "Fixed Assets", items: limit(value(6), query, (x) => [x.asset_number, x.asset_name]).map((x) => ({ id: x.id, title: `${x.asset_number} · ${x.asset_name}`, detail: x.status, type: "Fixed Asset", path: `/fixed-assets/${x.id}` })) },
    { label: "Production Orders", items: limit(value(7), query, (x) => [x.order_number, x.number, x.product?.name]).map((x) => ({ id: x.id, title: x.order_number || x.number, detail: x.product?.name, type: "Production Order", path: `/manufacturing/production-orders/${x.id}` })) },
  ].filter((group) => group.items.length);
}
