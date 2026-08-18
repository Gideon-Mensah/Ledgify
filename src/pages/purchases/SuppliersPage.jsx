import SupplierDirectory from "../../components/suppliers/SupplierDirectory";

// Renders the suppliers page component.
function SuppliersPage() {
  return (
    <SupplierDirectory
      eyebrow="Purchases"
      description="Manage supplier records, balances, terms and purchasing history."
      newSupplierPath="/purchases/suppliers/new"
      supplierDetailsBasePath="/purchases/suppliers"
    />
  );
}

export default SuppliersPage;