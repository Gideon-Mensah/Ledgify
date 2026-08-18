import {
  suppliers as defaultSuppliers,
} from "../data/suppliers";

const STORAGE_KEY =
  "ledgify_suppliers";

// Performs the clone data task.
const cloneData = (data) =>
  JSON.parse(JSON.stringify(data));

// Performs the initialise suppliers task.
const initialiseSuppliers = () => {
  const storedSuppliers =
    localStorage.getItem(STORAGE_KEY);

  if (storedSuppliers) {
    try {
      return JSON.parse(
        storedSuppliers
      );
    } catch (error) {
      console.error(
        "Unable to read saved suppliers:",
        error
      );
    }
  }

  const initialSuppliers =
    cloneData(defaultSuppliers);

  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(
      initialSuppliers
    )
  );

  return initialSuppliers;
};

// Gets suppliers.
export const getSuppliers = () => {
  return initialiseSuppliers();
};

// Gets supplier by id.
export const getSupplierById = (
  supplierId
) => {
  return getSuppliers().find(
    (supplier) =>
      Number(supplier.id) ===
      Number(supplierId)
  );
};

// Saves suppliers.
export const saveSuppliers = (
  suppliers
) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(suppliers)
  );

  return suppliers;
};

// Updates supplier.
export const updateSupplier = (
  supplierId,
  updatedFields
) => {
  const updatedSuppliers =
    getSuppliers().map(
      (supplier) =>
        Number(supplier.id) ===
          Number(supplierId)
          ? {
            ...supplier,
            ...updatedFields,
          }
          : supplier
    );

  saveSuppliers(updatedSuppliers);

  return updatedSuppliers.find(
    (supplier) =>
      Number(supplier.id) ===
      Number(supplierId)
  );
};

// Gets next supplier account number.
export const getNextSupplierAccountNumber = () => {
  const suppliers = getSuppliers();

  const highestNumber = suppliers.reduce(
    (highest, supplier) => {
      const numericPart = Number(
        String(
          supplier.accountNumber || ""
        ).replace(/\D/g, "")
      );

      return Number.isFinite(numericPart)
        ? Math.max(highest, numericPart)
        : highest;
    },
    0
  );

  return `SUP-${String(
    highestNumber + 1
  ).padStart(3, "0")}`;
};

// Performs the supplier exists task.
export const supplierExists = (
  name,
  email
) => {
  const normalisedName = String(
    name || ""
  )
    .trim()
    .toLowerCase();

  const normalisedEmail = String(
    email || ""
  )
    .trim()
    .toLowerCase();

  return getSuppliers().some(
    (supplier) =>
      String(supplier.name || "")
        .trim()
        .toLowerCase() ===
      normalisedName ||
      (
        normalisedEmail &&
        String(supplier.email || "")
          .trim()
          .toLowerCase() ===
        normalisedEmail
      )
  );
};

// Performs the supplier exists for edit task.
export const supplierExistsForEdit = (
  supplierId,
  name,
  email,
  accountNumber
) => {
  const normalisedName = String(name || "")
    .trim()
    .toLowerCase();

  const normalisedEmail = String(email || "")
    .trim()
    .toLowerCase();

  const normalisedAccountNumber = String(
    accountNumber || ""
  )
    .trim()
    .toLowerCase();

  return getSuppliers().some((supplier) => {
    if (
      Number(supplier.id) ===
      Number(supplierId)
    ) {
      return false;
    }

    const sameName =
      String(supplier.name || "")
        .trim()
        .toLowerCase() ===
      normalisedName;

    const sameEmail =
      normalisedEmail &&
      String(supplier.email || "")
        .trim()
        .toLowerCase() ===
      normalisedEmail;

    const sameAccountNumber =
      normalisedAccountNumber &&
      String(
        supplier.accountNumber || ""
      )
        .trim()
        .toLowerCase() ===
      normalisedAccountNumber;

    return (
      sameName ||
      sameEmail ||
      sameAccountNumber
    );
  });
};

// Creates supplier.
export const createSupplier = (
  supplierData
) => {
  const suppliers =
    getSuppliers();

  const nextId =
    suppliers.length > 0
      ? Math.max(
        ...suppliers.map(
          (supplier) =>
            Number(
              supplier.id
            ) || 0
        )
      ) + 1
      : 1;

  const now =
    new Date().toISOString();

  const newSupplier = {
    id: nextId,
    name:
      supplierData.name || "",
    contactName:
      supplierData.contactName ||
      "",
    email:
      supplierData.email || "",
    phone:
      supplierData.phone || "",
    website:
      supplierData.website || "",
    address:
      supplierData.address || {
        line1: "",
        line2: "",
        city: "",
        county: "",
        postcode: "",
        country:
          "United Kingdom",
      },
    paymentTerms:
      supplierData.paymentTerms ||
      "30 days",
    currency:
      supplierData.currency ||
      "GBP",
    taxNumber:
      supplierData.taxNumber ||
      "",
    accountNumber:

      supplierData.accountNumber ||
      getNextSupplierAccountNumber(),
    defaultExpenseAccount:
      supplierData.defaultExpenseAccount ||
      "",
    status:
      supplierData.status ||
      "Active",
    notes:
      supplierData.notes || "",
    createdAt: now,
    updatedAt: now,
  };

  saveSuppliers([
    ...suppliers,
    newSupplier,
  ]);

  return newSupplier;
};

// Performs the edit supplier task.
export const editSupplier = (
  supplierId,
  supplierData
) => {
  const supplier =
    getSupplierById(supplierId);

  if (!supplier) {
    throw new Error(
      "Supplier not found."
    );
  }

  if (
    supplierExistsForEdit(
      supplierId,
      supplierData.name,
      supplierData.email,
      supplierData.accountNumber
    )
  ) {
    throw new Error(
      "Another supplier already uses this name, email address or account number."
    );
  }

  return updateSupplier(
    supplierId,
    {
      ...supplierData,
      updatedAt:
        new Date().toISOString(),
    }
  );
};

// Performs the change supplier status task.
export const changeSupplierStatus = (
  supplierId,
  status
) => {
  if (
    ![
      "Active",
      "Inactive",
    ].includes(status)
  ) {
    throw new Error(
      "Invalid supplier status."
    );
  }

  return updateSupplier(
    supplierId,
    {
      status,
      updatedAt:
        new Date().toISOString(),
    }
  );
};

// Deletes supplier.
export const deleteSupplier = (
  supplierId
) => {
  const supplier =
    getSupplierById(supplierId);

  if (!supplier) {
    throw new Error(
      "Supplier not found."
    );
  }

  const remainingSuppliers =
    getSuppliers().filter(
      (currentSupplier) =>
        Number(currentSupplier.id) !==
        Number(supplierId)
    );

  saveSuppliers(
    remainingSuppliers
  );

  return supplier;
};

// Resets suppliers.
export const resetSuppliers =
  () => {
    const initialSuppliers =
      cloneData(defaultSuppliers);

    saveSuppliers(
      initialSuppliers
    );

    return initialSuppliers;
  };