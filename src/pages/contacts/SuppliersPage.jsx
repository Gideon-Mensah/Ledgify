import SupplierDirectory from "../../components/suppliers/SupplierDirectory";

// Renders the suppliers page component.
function SuppliersPage() {
  return (
    <SupplierDirectory
      eyebrow="Contacts"
      description="Manage supplier contact details, balances, payment terms and purchasing activity."
      newSupplierPath="/purchases/suppliers/new"
      supplierDetailsBasePath="/purchases/suppliers"
    />
  );
}

export default SuppliersPage;