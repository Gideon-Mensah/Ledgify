import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../store/AuthContext";
import ProtectedRoute from "./ProtectedRoute";
import LoginPage from "../pages/auth/LoginPage";
import OrganisationSelectionPage from "../pages/auth/OrganisationSelectionPage";

import MainLayout from "../components/layout/MainLayout";

import DashboardPage from "../pages/dashboard/DashboardPage";

import InvoicesPage from "../pages/sales/InvoicesPage";
import NewInvoicePage from "../pages/sales/NewInvoicePage";
import InvoiceDetailsPage from "../pages/sales/InvoiceDetailsPage";

import BillsPage from "../pages/purchases/BillsPage";
import { LiveCommercialDetailPage, LiveCommercialListPage } from "../pages/commercial/LiveCommercialPages";
import LiveTaxCreditPage from "../pages/commercial/LiveTaxCreditPage";

import {
    LiveBankAccountsPage,
    LiveBankTransactionsPage,
    LiveReconciliationPage,
} from "../pages/banking/LiveBankingPages";

import CustomersPage from "../pages/contacts/CustomersPage";
import ContactSuppliersPage from "../pages/contacts/SuppliersPage";

import {
    LiveProductDetailsPage,
    LiveInventoryReportsPage,
    LiveInventoryWorkflowPage,
    LiveProductsPage,
    LiveStockCountsPage,
    LiveStockAdjustmentPage,
} from "../pages/inventory/LiveInventoryPages";

import {
  LiveAccountsPage,
  LiveFinancialYearsPage,
  LiveJournalsPage,
  LivePeriodsPage,
  LiveReportPage,
  LiveStatementPage,
} from "../pages/accounting/LiveAccountingPages";
import { LiveDepreciationPage, LiveFixedAssetDetailPage, LiveFixedAssetsPage } from "../pages/accounting/LiveFixedAssetPages";

import ReportsPage from "../pages/reports/ReportsPage";
import FinancialAnalysisPage from "../pages/reports/FinancialAnalysisPage";
import VatReturnsPage from "../pages/tax/VatReturnsPage";
import TaxSettingsPage from "../pages/tax/TaxSettingsPage";
import PayrollPage from "../pages/payroll/PayrollPage";
import FXPage from "../pages/accounting/FXPage";
import ConsolidationPage from "../pages/accounting/ConsolidationPage";
import AIAssistantPage from "../pages/ai/AIAssistantPage";
import CompanySettingsPage from "../pages/settings/CompanySettingsPage";
import JournalDetailsPage from "../pages/accounting/JournalDetailsPage";
import NewJournalPage from "../pages/accounting/NewJournalPage";
import AccountDetailsPage from "../pages/accounting/AccountDetailsPage";
import CashFlowBreakdownPage from "../pages/accounting/CashFlowBreakdownPage";

import NotFoundPage from "../pages/NotFoundPage";

import NewBillPage from "../pages/purchases/NewBillPage";
import BillDetailsPage from "../pages/purchases/BillDetailsPage";
import EditBillPage from "../pages/purchases/EditBillPage";
import NewSupplierPage from "../pages/purchases/NewSupplierPage";
import SupplierDetailsPage from "../pages/purchases/SupplierDetailsPage";
import EditSupplierPage from "../pages/purchases/EditSupplierPage";
import { LiveBankImportPage, LiveBankRulesPage, LiveCashCodingPage } from "../pages/banking/LiveProfessionalBankingPages";
import NewCustomerPage from "../pages/contacts/NewCustomerPage";
import CustomerDetailsPage from "../pages/contacts/CustomerDetailsPage";
import EditCustomerPage from "../pages/contacts/EditCustomerPage";
import { BOMDetailsPage, BOMListPage, ManufacturingDashboardPage, ManufacturingReportsPage, ProductionOrderDetailsPage, ProductionOrdersPage } from "../pages/manufacturing/ManufacturingPages";
import { useAuth } from "../store/AuthContext";


// Renders the app routes component.
function ManufacturingAccess({ children }) {
    const auth = useAuth();
    return auth.hasPermission("view_manufacturing") ? children : <Navigate to="/" replace />;
}

function FixedAssetsAccess({ children }) {
    const auth = useAuth();
    return auth.hasPermission("view_fixed_assets") ? children : <Navigate to="/" replace />;
}

function AppRoutes() {
    return (
        <BrowserRouter>
          <AuthProvider>
            <Routes>
                <Route path="login" element={<LoginPage />} />
                <Route path="select-organisation" element={<OrganisationSelectionPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<MainLayout />}>
                    <Route index element={<DashboardPage />} />

                    <Route path="sales/invoices" element={<InvoicesPage />} />
                    <Route
                        path="sales/invoices/new"
                        element={<NewInvoicePage />}
                    />
                    <Route
                        path="sales/invoices/:invoiceId/edit"
                        element={<NewInvoicePage editMode />}
                    />
                    <Route
                        path="sales/invoices/:invoiceId"
                        element={<InvoiceDetailsPage />}
                    />

                    <Route path="sales/quotes" element={<LiveCommercialListPage type="quotes" />} />
                    <Route
                        path="sales/quotes/new"
                        element={<Navigate to="/sales/quotes" replace />}
                    />
                    <Route
                        path="sales/quotes/:quoteId/edit"
                        element={<Navigate to="/sales/quotes" replace />}
                    />

                    <Route
                        path="sales/quotes/:quoteId"
                        element={<LiveCommercialDetailPage type="quotes" />}
                    />

                    <Route
                        path="sales/credit-notes/new"
                        element={<LiveTaxCreditPage />}
                    />

                    <Route
                        path="sales/credit-notes/:creditNoteId/edit"
                        element={<Navigate to="/sales/credit-notes" replace />}
                    />

                    <Route
                        path="sales/credit-notes/:creditNoteId"
                        element={<LiveCommercialDetailPage type="customer-credits" />}
                    />

                    <Route
                        path="sales/credit-notes"
                        element={<LiveCommercialListPage type="customer-credits" />}
                    />


                    <Route
                        path="purchases/bills/new"
                        element={<NewBillPage />}
                    />
                    <Route path="purchases/supplier-credits" element={<LiveCommercialListPage type="supplier-credits" />} />
                    <Route path="purchases/supplier-credits/new" element={<LiveTaxCreditPage supplier />} />
                    <Route path="purchases/supplier-credits/:creditNoteId" element={<LiveCommercialDetailPage type="supplier-credits" />} />

                    <Route
                        path="purchases/bills/:billId/edit"
                        element={<EditBillPage />}
                    />

                    <Route
                        path="purchases/bills/:billId"
                        element={<BillDetailsPage />}
                    />

                    <Route
                        path="purchases/bills"
                        element={<BillsPage />}
                    />

                    <Route
                        path="purchases/suppliers/new"
                        element={<NewSupplierPage />}
                    />

                    <Route
                        path="purchases/suppliers/:supplierId/edit"
                        element={<EditSupplierPage />}
                    />

                    <Route
                        path="purchases/suppliers/:supplierId"
                        element={<SupplierDetailsPage />}
                    />
                    <Route
                        path="purchases/suppliers/:supplierId/statement"
                        element={<LiveStatementPage type="supplier" />}
                    />

                    <Route
                        path="purchases/suppliers"
                        element={<ContactSuppliersPage />}
                    />
                    <Route
                        path="purchases/orders/new"
                        element={<Navigate to="/purchases/orders" replace />}
                    />

                    <Route
                        path="purchases/orders/:purchaseOrderId/edit"
                        element={<Navigate to="/purchases/orders" replace />}
                    />

                    <Route
                        path="purchases/orders/:purchaseOrderId"
                        element={<LiveCommercialDetailPage type="purchase-orders" />}
                    />

                    <Route
                        path="purchases/orders"
                        element={<LiveCommercialListPage type="purchase-orders" />}
                    />
                    <Route path="sales/orders" element={<LiveCommercialListPage type="sales-orders" />} />
                    <Route path="sales/orders/:salesOrderId" element={<LiveCommercialDetailPage type="sales-orders" />} />

                    <Route path="banking/accounts" element={<LiveBankAccountsPage />} />
                    <Route
                        path="banking/transactions"
                        element={<LiveBankTransactionsPage />}
                    />
                    <Route
                        path="banking/reconciliation"
                        element={<LiveReconciliationPage />}
                    />

                    <Route
                        path="/banking/rules"
                        element={<LiveBankRulesPage />}
                    />

                    <Route
                        path="contacts/suppliers"
                        element={<ContactSuppliersPage />} />

                    <Route
                        path="contacts/customers"
                        element={<CustomersPage />} />

                    <Route
                        path="/contacts/customers/new"
                        element={<NewCustomerPage />}
                    />

                    <Route
                        path="contacts/customers/:customerId/edit"
                        element={<EditCustomerPage />}
                    />

                    <Route
                        path="contacts/customers/:customerId/statement"
                        element={<LiveStatementPage type="customer" />}
                    />

                    <Route
                        path="/contacts/customers/:customerId"
                        element={<CustomerDetailsPage />}
                    />

                    <Route path="inventory/products" element={<LiveProductsPage />} />
                    <Route
                        path="inventory/products/:productId"
                        element={<LiveProductDetailsPage />}
                    />

                    <Route
                        path="inventory/stock-adjustments"
                        element={<LiveStockAdjustmentPage />}
                    />
                    <Route path="inventory/purchase-receipts" element={<LiveInventoryWorkflowPage kind="purchase-receipts" />} />
                    <Route path="inventory/sales-issues" element={<LiveInventoryWorkflowPage kind="sales-issues" />} />
                    <Route path="inventory/transfers" element={<LiveInventoryWorkflowPage kind="transfers" />} />
                    <Route path="inventory/customer-returns" element={<LiveInventoryWorkflowPage kind="customer-returns" />} />
                    <Route path="inventory/supplier-returns" element={<LiveInventoryWorkflowPage kind="supplier-returns" />} />
                    <Route path="inventory/stock-counts" element={<LiveStockCountsPage />} />
                    <Route path="inventory/reports" element={<LiveInventoryReportsPage />} />

                    <Route path="manufacturing" element={<ManufacturingAccess><ManufacturingDashboardPage /></ManufacturingAccess>} />
                    <Route path="manufacturing/boms" element={<ManufacturingAccess><BOMListPage /></ManufacturingAccess>} />
                    <Route path="manufacturing/boms/:bomId" element={<ManufacturingAccess><BOMDetailsPage /></ManufacturingAccess>} />
                    <Route path="manufacturing/production-orders" element={<ManufacturingAccess><ProductionOrdersPage /></ManufacturingAccess>} />
                    <Route path="manufacturing/production-orders/:orderId" element={<ManufacturingAccess><ProductionOrderDetailsPage /></ManufacturingAccess>} />
                    <Route path="manufacturing/reports" element={<ManufacturingAccess><ManufacturingReportsPage /></ManufacturingAccess>} />

                    <Route
                        path="accounting/chart-of-accounts"
                        element={<LiveAccountsPage />}
                    />
                    <Route path="accounting/accounts/:accountId" element={<AccountDetailsPage />} />
                    <Route path="accounting/journals"
                        element={<LiveJournalsPage />} />
                    <Route path="accounting/journals/new" element={<NewJournalPage />} />
                    <Route path="accounting/journals/:journalId" element={<JournalDetailsPage />} />

                    <Route
                        path="/accounting/general-ledger"
                        element={<LiveReportPage report="general-ledger" />}
                    />
                    <Route
                        path="/accounting/trial-balance"
                        element={<LiveReportPage report="trial-balance" />}
                    />
                    <Route
                        path="/accounting/profit-and-loss"
                        element={<LiveReportPage report="profit-and-loss" />}
                    />
                    <Route
                        path="/accounting/balance-sheet"
                        element={<LiveReportPage report="balance-sheet" />}
                    />
                    <Route
                        path="/accounting/cash-flow"
                        element={<LiveReportPage report="cash-flow" />}
                    />
                    <Route
                        path="/accounting/cash-flow/breakdown/:rowKey"
                        element={<CashFlowBreakdownPage />}
                    />
                    <Route
                        path="/accounting/aged-receivables"
                        element={<LiveReportPage report="aged-receivables" />}
                    />
                    <Route
                        path="/accounting/aged-payables"
                        element={<LiveReportPage report="aged-payables" />}
                    />
                    <Route
                        path="accounting/fixed-assets"
                        element={<Navigate to="/fixed-assets" replace />}
                    />
                    <Route
                        path="/accounting/depreciation-run"
                        element={<Navigate to="/fixed-assets/depreciation" replace />}
                    />
                    <Route
                        path="/accounting/fixed-assets/:assetId"
                        element={<FixedAssetsAccess><LiveFixedAssetDetailPage /></FixedAssetsAccess>}
                    />
                    <Route path="fixed-assets" element={<FixedAssetsAccess><LiveFixedAssetsPage /></FixedAssetsAccess>} />
                    <Route path="fixed-assets/depreciation" element={<FixedAssetsAccess><LiveDepreciationPage /></FixedAssetsAccess>} />
                    <Route path="fixed-assets/:assetId" element={<FixedAssetsAccess><LiveFixedAssetDetailPage /></FixedAssetsAccess>} />
                    <Route
                        path="accounting/financial-year"
                        element={<LiveFinancialYearsPage />}
                    />

                    <Route
                        path="accounting/period-locks"
                        element={<LivePeriodsPage />}
                    />


                    <Route path="reports" element={<ReportsPage />} />
                    <Route path="reports/financial-analysis" element={<FinancialAnalysisPage />} />
                    <Route path="tax/vat-returns" element={<VatReturnsPage />} />
                    <Route path="tax/settings" element={<TaxSettingsPage />} />
                    <Route path="payroll" element={<PayrollPage />} />
                    <Route path="accounting/fx" element={<FXPage />} />
                    <Route path="accounting/consolidation" element={<ConsolidationPage />} />
                    <Route path="ai" element={<AIAssistantPage />} />
                    <Route
                        path="settings/company"
                        element={<Navigate to="/settings" replace />}
                    />
                    <Route path="settings" element={<CompanySettingsPage />} />
                    <Route path="settings/:section" element={<CompanySettingsPage />} />
                    <Route
                        path="banking/cash-coding"
                        element={<LiveCashCodingPage />}
                    />
                    <Route path="banking/import" element={<LiveBankImportPage />} />
                  </Route>
                </Route>

                <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
    );
}

export default AppRoutes;
