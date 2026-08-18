import {
  customers as defaultCustomers,
} from "../data/customers";

const STORAGE_KEY = "ledgify_customers";

// Performs the clone data task.
const cloneData = (data) =>
  JSON.parse(JSON.stringify(data));

// Normalizes text.
const normaliseText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

// Saves customers.
const saveCustomers = (customers) => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(customers)
  );

  return customers;
};

// Performs the initialise customers task.
const initialiseCustomers = () => {
  const storedCustomers =
    localStorage.getItem(STORAGE_KEY);

  if (storedCustomers) {
    try {
      const parsedCustomers =
        JSON.parse(storedCustomers);

      if (Array.isArray(parsedCustomers)) {
        return parsedCustomers;
      }
    } catch (error) {
      console.error(
        "Unable to read saved customers:",
        error
      );
    }
  }

  const initialCustomers =
    cloneData(defaultCustomers);

  saveCustomers(initialCustomers);

  return initialCustomers;
};

// Gets customers.
export const getCustomers = () => {
  return initialiseCustomers();
};

// Gets customer by id.
export const getCustomerById = (
  customerId
) => {
  return getCustomers().find(
    (customer) =>
      Number(customer.id) ===
      Number(customerId)
  );
};

// Gets active customers.
export const getActiveCustomers = () => {
  return getCustomers().filter(
    (customer) =>
      customer.status === "Active"
  );
};

// Performs the search customers task.
export const searchCustomers = (
  searchTerm
) => {
  const normalisedSearch =
    normaliseText(searchTerm);

  if (!normalisedSearch) {
    return getCustomers();
  }

  return getCustomers().filter(
    (customer) =>
      normaliseText(
        customer.name
      ).includes(normalisedSearch) ||
      normaliseText(
        customer.contactName
      ).includes(normalisedSearch) ||
      normaliseText(
        customer.email
      ).includes(normalisedSearch) ||
      normaliseText(
        customer.phone
      ).includes(normalisedSearch) ||
      normaliseText(
        customer.accountNumber
      ).includes(normalisedSearch)
  );
};

// Gets next customer account number.
export const getNextCustomerAccountNumber =
  () => {
    const highestNumber =
      getCustomers().reduce(
        (highest, customer) => {
          const numericPart = Number(
            String(
              customer.accountNumber || ""
            ).replace(/\D/g, "")
          );

          if (
            !Number.isFinite(numericPart)
          ) {
            return highest;
          }

          return Math.max(
            highest,
            numericPart
          );
        },
        0
      );

    return `CUS-${String(
      highestNumber + 1
    ).padStart(3, "0")}`;
  };

// Performs the customer exists task.
export const customerExists = ({
  name,
  email,
  accountNumber,
  excludeCustomerId = null,
}) => {
  const normalisedName =
    normaliseText(name);

  const normalisedEmail =
    normaliseText(email);

  const normalisedAccountNumber =
    normaliseText(accountNumber);

  return getCustomers().some(
    (customer) => {
      if (
        excludeCustomerId !== null &&
        Number(customer.id) ===
          Number(excludeCustomerId)
      ) {
        return false;
      }

      const sameName =
        normalisedName &&
        normaliseText(
          customer.name
        ) === normalisedName;

      const sameEmail =
        normalisedEmail &&
        normaliseText(
          customer.email
        ) === normalisedEmail;

      const sameAccountNumber =
        normalisedAccountNumber &&
        normaliseText(
          customer.accountNumber
        ) ===
          normalisedAccountNumber;

      return (
        sameName ||
        sameEmail ||
        sameAccountNumber
      );
    }
  );
};

// Creates customer.
export const createCustomer = (
  customerData
) => {
  const customers = getCustomers();

  const name = String(
    customerData.name || ""
  ).trim();

  if (!name) {
    throw new Error(
      "Customer name is required."
    );
  }

  const accountNumber =
    String(
      customerData.accountNumber || ""
    ).trim() ||
    getNextCustomerAccountNumber();

  if (
    customerExists({
      name,
      email: customerData.email,
      accountNumber,
    })
  ) {
    throw new Error(
      "A customer with this name, email address, or account number already exists."
    );
  }

  const nextId =
    customers.length > 0
      ? Math.max(
          ...customers.map(
            (customer) =>
              Number(customer.id) || 0
          )
        ) + 1
      : 1;

  const now =
    new Date().toISOString();

  const newCustomer = {
    id: nextId,
    name,
    contactName: String(
      customerData.contactName || ""
    ).trim(),
    email: String(
      customerData.email || ""
    ).trim(),
    phone: String(
      customerData.phone || ""
    ).trim(),
    website: String(
      customerData.website || ""
    ).trim(),
    address: {
      line1: String(
        customerData.address?.line1 ||
          ""
      ).trim(),
      line2: String(
        customerData.address?.line2 ||
          ""
      ).trim(),
      city: String(
        customerData.address?.city ||
          ""
      ).trim(),
      county: String(
        customerData.address?.county ||
          ""
      ).trim(),
      postcode: String(
        customerData.address?.postcode ||
          ""
      ).trim(),
      country:
        String(
          customerData.address
            ?.country || ""
        ).trim() ||
        "United Kingdom",
    },
    paymentTerms:
      customerData.paymentTerms ||
      "30 days",
    currency:
      customerData.currency ||
      "GBP",
    taxNumber: String(
      customerData.taxNumber || ""
    ).trim(),
    accountNumber,
    defaultIncomeAccount:
      customerData.defaultIncomeAccount ||
      "200",
    creditLimit:
      Number(
        customerData.creditLimit
      ) || 0,
    status:
      customerData.status ||
      "Active",
    notes: String(
      customerData.notes || ""
    ).trim(),
    createdAt: now,
    updatedAt: now,
  };

  saveCustomers([
    ...customers,
    newCustomer,
  ]);

  return newCustomer;
};

// Updates customer.
export const updateCustomer = (
  customerId,
  customerData
) => {
  const customer =
    getCustomerById(customerId);

  if (!customer) {
    throw new Error(
      "Customer not found."
    );
  }

  const name = String(
    customerData.name ??
      customer.name
  ).trim();

  const accountNumber =
    String(
      customerData.accountNumber ??
        customer.accountNumber
    ).trim();

  if (!name) {
    throw new Error(
      "Customer name is required."
    );
  }

  if (
    customerExists({
      name,
      email:
        customerData.email ??
        customer.email,
      accountNumber,
      excludeCustomerId:
        customerId,
    })
  ) {
    throw new Error(
      "Another customer already uses this name, email address, or account number."
    );
  }

  const updatedCustomer = {
    ...customer,
    ...customerData,
    id: customer.id,
    name,
    accountNumber,
    address: {
      ...customer.address,
      ...(customerData.address || {}),
    },
    creditLimit:
      customerData.creditLimit !==
      undefined
        ? Number(
            customerData.creditLimit
          ) || 0
        : customer.creditLimit,
    updatedAt:
      new Date().toISOString(),
  };

  const updatedCustomers =
    getCustomers().map((item) =>
      Number(item.id) ===
      Number(customerId)
        ? updatedCustomer
        : item
    );

  saveCustomers(updatedCustomers);

  return updatedCustomer;
};

// Performs the change customer status task.
export const changeCustomerStatus = (
  customerId,
  status
) => {
  if (
    ![
      "Active",
      "Inactive",
    ].includes(status)
  ) {
    throw new Error(
      "Invalid customer status."
    );
  }

  return updateCustomer(
    customerId,
    {
      status,
    }
  );
};

// Deletes customer.
export const deleteCustomer = (
  customerId
) => {
  const customer =
    getCustomerById(customerId);

  if (!customer) {
    throw new Error(
      "Customer not found."
    );
  }

  const remainingCustomers =
    getCustomers().filter(
      (item) =>
        Number(item.id) !==
        Number(customerId)
    );

  saveCustomers(
    remainingCustomers
  );

  return customer;
};

// Resets customers.
export const resetCustomers = () => {
  const initialCustomers =
    cloneData(defaultCustomers);

  saveCustomers(
    initialCustomers
  );

  return initialCustomers;
};