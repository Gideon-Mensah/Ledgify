import {
  LayoutDashboard,
  FileText,
  ReceiptText,
  Landmark,
  Users,
  Package,
  Calculator,
  ChartNoAxesCombined,
  Settings,
  Factory,
  Sparkles,
  Building2,
} from "lucide-react";
import { AI_ENABLED } from "../config/featureFlags";

export const mainNavigation = [
  {
    label: "Dashboard",
    path: "/",
    icon: LayoutDashboard,
  },
  {
    label: "Sales",
    icon: FileText,
    children: [
      {
        label: "Invoices",
        path: "/sales/invoices",
      },
      {
        label: "Customers",
        path: "/contacts/customers",
      },
      { label: "Quotes", path: "/sales/quotes" },
      { label: "Sales Orders", path: "/sales/orders" },
      { label: "Credit Notes", path: "/sales/credit-notes" },
    ],
  },
  {
    label: "Purchases",
    icon: ReceiptText,
    children: [
      {
        label: "Bills",
        path: "/purchases/bills",
      },
      {
        label: "Suppliers",
        path: "/purchases/suppliers",
      },
      { label: "Purchase Orders", path: "/purchases/orders" },
      { label: "Supplier Credits", path: "/purchases/supplier-credits" },
    ],
  },
  {
    label: "Banking",
    icon: Landmark,
    children: [
      {
        label: "Bank Accounts",
        path: "/banking/accounts",
      },
      {
        label: "Transactions",
        path: "/banking/transactions",
      },
      {
        label: "Reconciliation",
        path: "/banking/reconciliation",
      },
      { label: "Statement Import", path: "/banking/import" },
      { label: "Bank Rules", path: "/banking/rules" },
      { label: "Cash Coding", path: "/banking/cash-coding" },
    ],
  },
  {
    label: "Contacts",
    icon: Users,
    children: [
      {
        label: "Customers",
        path: "/contacts/customers",
      },
      {
        label: "Suppliers",
        path: "/contacts/suppliers",
      },
    ],
  },
  {
    label: "Inventory",
    icon: Package,
    children: [
      {
        label: "Products",
        path: "/inventory/products",
      },
      { label: "Warehouses", path: "/inventory/products" },
      { label: "Stock Movements", path: "/inventory/reports" },
      {
        label: "Stock Adjustments",
        path: "/inventory/stock-adjustments",
      },
      { label: "Purchase Receipts", path: "/inventory/purchase-receipts" },
      { label: "Sales Issues", path: "/inventory/sales-issues" },
      { label: "Stock Transfers", path: "/inventory/transfers" },
      { label: "Customer Returns", path: "/inventory/customer-returns" },
      { label: "Supplier Returns", path: "/inventory/supplier-returns" },
      { label: "Stock Counts", path: "/inventory/stock-counts" },
      { label: "Inventory Reports", path: "/inventory/reports" },
    ],
  },
  {
    label: "Accounting",
    icon: Calculator,
    children: [
      {
        label: "Chart of Accounts",
        path: "/accounting/chart-of-accounts",
      },
      {
        label: "Journals",
        path: "/accounting/journals",
      },
      {
        label: "Financial Year",
        path: "/accounting/financial-year",
      },
      {
        label: "Period Locks",
        path: "/accounting/period-locks",
      },
      { label: "Currencies & FX", path: "/accounting/fx" },
      { label: "Consolidation", path: "/accounting/consolidation" },
    ],
  },
  {
    label: "Fixed Assets",
    icon: Building2,
    permission: "view_fixed_assets",
    children: [
      { label: "Asset Register", path: "/fixed-assets" },
      { label: "Depreciation", path: "/fixed-assets/depreciation" },
    ],
  },
  {
    label: "Manufacturing",
    icon: Factory,
    permission: "view_manufacturing",
    children: [
      { label: "Dashboard", path: "/manufacturing" },
      { label: "Bills of Materials", path: "/manufacturing/boms" },
      { label: "Production Orders", path: "/manufacturing/production-orders" },
      { label: "Reports", path: "/manufacturing/reports" },
    ],
  },
  {
    label: "Payroll",
    path: "/payroll",
    icon: Users,
  },
  {
    label: "Tax",
    icon: Calculator,
    children: [
      { label: "Tax Settings", path: "/tax/settings" },
      { label: "Tax Rates", path: "/tax/settings#rates" },
      { label: "Tax Periods", path: "/tax/vat-returns#periods" },
      { label: "Tax Summary", path: "/tax/vat-returns" },
      { label: "Tax Transactions", path: "/tax/vat-returns#transactions" },
      { label: "Tax Return Preview", path: "/tax/vat-returns#preview" },
    ],
  },
  {
    label: "Reports",
    icon: ChartNoAxesCombined,
    children: [
      { label: "Reports Centre", path: "/reports" },
      { label: "Financial Analysis", path: "/reports/financial-analysis" },
    ],
  },
  ...(AI_ENABLED ? [{ label: "AI Assistant", path: "/ai", icon: Sparkles, permission: "use_ai_assistant" }] : []),
  {
    label: "Settings",
    path: "/settings",
    icon: Settings,
  },
];
