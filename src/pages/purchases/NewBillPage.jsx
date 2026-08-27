// Build a supplier bill payload without calculating or posting accounting in React.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowLeft,
  CheckCircle2,
  Plus,
  Save,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import {
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import PageHeader from "../../components/layout/PageHeader";

import { contactApiService } from "../../services/contactApiService";
import { purchasesApiService } from "../../services/purchasesApiService";
import { accountLookupService } from "../../services/accountLookupService";
import { normaliseApiError } from "../../services/apiError";
import { taxApiService } from "../../services/taxApiService";

import { inventoryService } from "../../services/inventoryService";
import { useAuth } from "../../store/AuthContext";
import {
  addCalendarDays,
  formatDisplayDate,
  getOrganisationToday,
} from "../../utils/dateUtils";

import {
  calculateBillTotals,
} from "../../utils/billCalculations";

const paymentTermOptions = [
  "Due immediately",
  "7 days",
  "14 days",
  "30 days",
  "60 days",
];

const createRecordId = () => {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID ===
      "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
};

const calculateDueDate = (
  issueDate,
  paymentTerms
) => {
  if (!issueDate) {
    return "";
  }

  const daysByTerm = {
    "Due immediately": 0,
    "7 days": 7,
    "14 days": 14,
    "30 days": 30,
    "60 days": 60,
  };

  return addCalendarDays(
    issueDate,
    daysByTerm[paymentTerms] ||
      0
  );
};

const formatCurrency = (
  amount,
  currency = "GBP"
) => {
  try {
    return new Intl.NumberFormat(
      "en-GB",
      {
        style: "currency",
        currency:
          currency || "GBP",
      }
    ).format(Number(amount) || 0);
  } catch {
    return new Intl.NumberFormat(
      "en-GB",
      {
        style: "currency",
        currency: "GBP",
      }
    ).format(Number(amount) || 0);
  }
};

const roundQuantity = (
  quantity
) => {
  return (
    Math.round(
      ((Number(quantity) || 0) +
        Number.EPSILON) *
        1000
    ) / 1000
  );
};

const normaliseText = (
  value
) => {
  return String(value || "")
    .trim()
    .toLowerCase();
};

const resolveAccountCode = (
  accountValue,
  expenseAccounts = []
) => {
  const cleanedValue =
    normaliseText(accountValue);

  if (!cleanedValue) {
    return "";
  }

  const matchingAccount =
    expenseAccounts.find(
      (account) =>
        normaliseText(
          account.code
        ) === cleanedValue ||
        normaliseText(
          account.name
        ) === cleanedValue
    );

  if (matchingAccount) {
    return matchingAccount.code;
  }

  const accountAliases = {
    "cost of sales": "300",
    "cost of goods sold": "300",
    "direct cost": "310",
    "direct costs": "310",
    "office expense": "420",
    "office expenses": "420",
    "professional fee": "477",
    "professional fees": "477",
    travel: "485",
    "travel expense": "485",
    "travel expenses": "485",
  };

  return (
    accountAliases[
      cleanedValue
    ] || ""
  );
};

const createEmptyItem = () => ({
  id: createRecordId(),

  productId: "",
  productName: "",
  sku: "",
  itemType: "",

  description: "",
  quantity: 1,
  unitPrice: 0,
  discountRate: 0,
  vatRate: 20,
  taxRateId: "",

  accountCode: "",
  purchaseAccount: "",

  trackInventory: false,
  currentStock: 0,
  inventoryUnitCost: 0,
});

const getSupplierAddressLines = (
  address
) => {
  if (Array.isArray(address)) {
    return address
      .map((line) =>
        String(line || "").trim()
      )
      .filter(Boolean);
  }

  if (!address) {
    return [];
  }

  return [
    address.line1,
    address.line2,
    address.city,
    address.county,
    address.postcode,
    address.country,
  ]
    .map((line) =>
      String(line || "").trim()
    )
    .filter(Boolean);
};

function NewBillPage() {
  const auth = useAuth();
  const navigate =
    useNavigate();

  const [searchParams] =
    useSearchParams();

  const [
    suppliers,
    setSuppliers,
  ] = useState([]);

  const [
    catalogueItems,
    setCatalogueItems,
  ] = useState([]);
  const [expenseAccounts, setExpenseAccounts] = useState([]);

  const requestedSupplierId =
    searchParams.get(
      "supplierId"
    );

  const [details, setDetails] =
    useState(() => {
      const today = getOrganisationToday(auth.selectedOrganisation?.timezone);

      return {
        supplierId: "",
        billNumber: "",
        supplierReference: "",
        issueDate: today,

        dueDate:
          calculateDueDate(
            today,
            "30 days"
          ),

        paymentTerms: "30 days",
        currency: "GBP",
        pricingMode: "exclusive",
        category: "",
        notes: "",
      };
    });

  const [items, setItems] =
    useState([
      createEmptyItem(),
    ]);
  const [taxRates, setTaxRates] = useState([]);

  const [errors, setErrors] =
    useState({});

  const [
    isSaving,
    setIsSaving,
  ] = useState(false);

  const loadReferenceData =
    useCallback(async () => {
      try {
        const [storedSuppliers, accounts, configuredRates, products] = await Promise.all([
          contactApiService.suppliers(),
          accountLookupService.expense(),
          taxApiService.rates(),
          inventoryService.products({ status: "active" }),
        ]);
        setSuppliers(storedSuppliers);
        setExpenseAccounts(accounts);
        setTaxRates((Array.isArray(configuredRates) ? configuredRates : configuredRates.results || [])
          .filter((rate) => rate.status === "ACTIVE" && ["PURCHASES", "BOTH"].includes(rate.scope)));
        setCatalogueItems(Array.isArray(products) ? products : products.results || []);
      } catch (error) {
        setErrors({ form: normaliseApiError(error) });
      }
    }, []);

  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(loadReferenceData);
    return () => window.cancelAnimationFrame(initialLoad);
  }, [loadReferenceData]);

  useEffect(() => {
    window.addEventListener(
      "focus",
      loadReferenceData
    );

    return () => {
      window.removeEventListener(
        "focus",
        loadReferenceData
      );
    };
  }, [loadReferenceData]);

  useEffect(() => {
    const initialLoad = window.requestAnimationFrame(() => {
    const requestedSupplier =
      suppliers.find(
        (supplier) =>
          String(supplier.id) ===
          String(
            requestedSupplierId
          )
      );

    setDetails(
      (currentDetails) => {
        const paymentTerms =
          requestedSupplier
            ?.paymentTerms ||
          currentDetails.paymentTerms;

        return {
          ...currentDetails,

          billNumber:
            currentDetails.billNumber ||
            currentDetails.billNumber || `BILL-${Date.now()}`,

          supplierId:
            requestedSupplier
              ? String(
                  requestedSupplier.id
                )
              : currentDetails.supplierId,

          paymentTerms,

          currency:
            requestedSupplier
              ?.currency ||
            currentDetails.currency,

          dueDate:
            calculateDueDate(
              currentDetails.issueDate,
              paymentTerms
            ),
        };
      }
    );

    if (
      requestedSupplier
        ?.defaultExpenseAccount
    ) {
      const defaultAccountCode =
        resolveAccountCode(
          requestedSupplier
            .defaultExpenseAccount
        );

      setItems(
        (currentItems) =>
          currentItems.map(
            (item, index) =>
              index === 0 &&
              !item.accountCode
                ? {
                    ...item,
                    accountCode:
                      defaultAccountCode,
                  }
                : item
          )
      );
    }
    });
    return () => window.cancelAnimationFrame(initialLoad);
  }, [
    suppliers,
    requestedSupplierId,
  ]);

  const selectedSupplier =
    useMemo(() => {
      return (
        suppliers.find(
          (supplier) =>
            String(
              supplier.id
            ) ===
            String(
              details.supplierId
            )
        ) || null
      );
    }, [
      suppliers,
      details.supplierId,
    ]);

  const selectedSupplierAddress =
    useMemo(() => {
      return getSupplierAddressLines(
        selectedSupplier?.address
      );
    }, [selectedSupplier]);

  const productMap = useMemo(
    () =>
      catalogueItems.reduce(
        (map, product) => {
          map[
            String(product.id)
          ] = product;

          return map;
        },
        {}
      ),
    [catalogueItems]
  );

  const incomingStockByProduct =
    useMemo(() => {
      return items.reduce(
        (totals, item) => {
          if (
            !item.productId ||
            !item.trackInventory
          ) {
            return totals;
          }

          const productKey =
            String(
              item.productId
            );

          totals[productKey] =
            roundQuantity(
              (totals[productKey] ||
                0) +
                (Number(
                  item.quantity
                ) || 0)
            );

          return totals;
        },
        {}
      );
    }, [items]);

  const totals = useMemo(() => {
    return calculateBillTotals({
      items,

      pricingMode:
        details.pricingMode,
    });
  }, [
    items,
    details.pricingMode,
  ]);

  const handleDetailChange = (
    event
  ) => {
    const { name, value } =
      event.target;

    setDetails(
      (currentDetails) => {
        const updatedDetails = {
          ...currentDetails,
          [name]: value,
        };

        if (
          name === "issueDate" ||
          name === "paymentTerms"
        ) {
          const issueDate =
            name === "issueDate"
              ? value
              : currentDetails.issueDate;

          const paymentTerms =
            name === "paymentTerms"
              ? value
              : currentDetails.paymentTerms;

          updatedDetails.dueDate =
            calculateDueDate(
              issueDate,
              paymentTerms
            );
        }

        return updatedDetails;
      }
    );

    setErrors(
      (currentErrors) => ({
        ...currentErrors,
        [name]: "",
        form: "",
      })
    );
  };

  const handleSupplierChange = (
    event
  ) => {
    const supplierId =
      event.target.value;

    const supplier =
      suppliers.find(
        (currentSupplier) =>
          String(
            currentSupplier.id
          ) === String(supplierId)
      );

    setDetails(
      (currentDetails) => {
        const paymentTerms =
          supplier?.paymentTerms ||
          currentDetails.paymentTerms;

        return {
          ...currentDetails,

          supplierId,

          paymentTerms,

          currency:
            supplier?.currency ||
            currentDetails.currency,

          dueDate:
            calculateDueDate(
              currentDetails.issueDate,
              paymentTerms
            ),
        };
      }
    );

    if (
      supplier
        ?.defaultExpenseAccount
    ) {
      const defaultAccountCode =
        resolveAccountCode(
          supplier
            .defaultExpenseAccount
        );

      setItems(
        (currentItems) =>
          currentItems.map(
            (item, index) =>
              index === 0 &&
              !item.accountCode
                ? {
                    ...item,

                    accountCode:
                      defaultAccountCode,
                  }
                : item
          )
      );
    }

    setErrors(
      (currentErrors) => ({
        ...currentErrors,
        supplierId: "",
        form: "",
      })
    );
  };

  const handleProductChange = (
    itemId,
    productId
  ) => {
    const product =
      catalogueItems.find(
        (currentProduct) =>
          String(
            currentProduct.id
          ) === String(productId)
      );

    setItems(
      (currentItems) =>
        currentItems.map(
          (item) => {
            if (
              item.id !== itemId
            ) {
              return item;
            }

            if (!product) {
              return {
                ...item,

                productId: "",
                productName: "",
                sku: "",
                itemType: "",
                purchaseAccount: "",
                trackInventory:
                  false,
                currentStock: 0,
                inventoryUnitCost:
                  0,
              };
            }

            const productAccount =
              resolveAccountCode(
                product.purchaseAccount
              );

            const supplierAccount =
              resolveAccountCode(
                selectedSupplier
                  ?.defaultExpenseAccount
              );

            return {
              ...item,

              productId:
                String(product.id),

              productName:
                product.name || "",

              sku:
                product.sku || "",

              itemType:
                product.type || "",

              description:
                product.description ||
                product.name ||
                "",

              quantity:
                Number(
                  item.quantity
                ) > 0
                  ? item.quantity
                  : 1,

              unitPrice:
                Number(
                  product.purchaseCost
                ) || 0,

              vatRate:
                Number(
                  product.taxRate
                ) || 0,

              accountCode:
                productAccount ||
                item.accountCode ||
                supplierAccount ||
                "300",

              purchaseAccount:
                product.purchaseAccount ||
                "Cost of goods sold",

              trackInventory:
                Boolean(
                  product.trackInventory
                ),

              currentStock:
                Number(
                  product.quantityOnHand
                ) || 0,

              inventoryUnitCost:
                Number(
                  product.purchaseCost
                ) || 0,
            };
          }
        )
    );

    setErrors(
      (currentErrors) => ({
        ...currentErrors,
        items: "",
        form: "",
      })
    );
  };

  const handleItemChange = (
    itemId,
    field,
    value
  ) => {
    const numericFields = [
      "quantity",
      "unitPrice",
      "discountRate",
      "vatRate",
    ];

    setItems(
      (currentItems) =>
        currentItems.map(
          (item) =>
            item.id === itemId
              ? {
                  ...item,

                  [field]:
                    numericFields.includes(
                      field
                    )
                      ? value === ""
                        ? ""
                        : Number(value)
                      : value,
                }
              : item
        )
    );

    setErrors(
      (currentErrors) => ({
        ...currentErrors,
        items: "",
        form: "",
      })
    );
  };

  const addItem = () => {
    const supplierAccount =
      resolveAccountCode(
        selectedSupplier
          ?.defaultExpenseAccount
      );

    setItems(
      (currentItems) => [
        ...currentItems,

        {
          ...createEmptyItem(),

          accountCode:
            supplierAccount,
        },
      ]
    );
  };

  const removeItem = (
    itemId
  ) => {
    if (items.length === 1) {
      return;
    }

    setItems(
      (currentItems) =>
        currentItems.filter(
          (item) =>
            item.id !== itemId
        )
    );
  };

  const validateBill = (
    status
  ) => {
    const nextErrors = {};

    if (!details.supplierId) {
      nextErrors.supplierId =
        "Select a supplier.";
    } else if (
      !selectedSupplier
    ) {
      nextErrors.supplierId =
        "Select a valid supplier.";
    }

    if (
      !details.billNumber.trim()
    ) {
      nextErrors.billNumber =
        "Enter a bill number.";
    }

    if (!details.issueDate) {
      nextErrors.issueDate =
        "Select an issue date.";
    }

    if (!details.dueDate) {
      nextErrors.dueDate =
        "Select a due date.";
    }

    if (
      details.issueDate &&
      details.dueDate &&
      details.dueDate <
        details.issueDate
    ) {
      nextErrors.dueDate =
        "The due date cannot be before the issue date.";
    }

    const validItems =
      items.filter(
        (item) =>
          String(
            item.description || ""
          ).trim() &&
          Number(item.quantity) >
            0 &&
          Number(item.unitPrice) >=
            0 &&
          item.accountCode
      );

    if (
      validItems.length === 0
    ) {
      nextErrors.items =
        "Add at least one valid item with an expense account.";
    }

    const invalidQuantity =
      validItems.find(
        (item) =>
          !Number.isFinite(
            Number(item.quantity)
          ) ||
          Number(item.quantity) <=
            0
      );

    if (invalidQuantity) {
      nextErrors.items =
        "All quantities must be greater than zero.";
    }

    const invalidPrice =
      validItems.find(
        (item) =>
          !Number.isFinite(
            Number(
              item.unitPrice
            )
          ) ||
          Number(item.unitPrice) <
            0
      );

    if (invalidPrice) {
      nextErrors.items =
        "Unit prices must be zero or greater.";
    }

    const invalidDiscount =
      validItems.find(
        (item) =>
          Number(
            item.discountRate
          ) < 0 ||
          Number(
            item.discountRate
          ) > 100
      );

    if (invalidDiscount) {
      nextErrors.items =
        "Discount percentages must be between 0% and 100%.";
    }

    if (totals.total <= 0) {
      nextErrors.items =
        "The bill total must be greater than zero.";
    }

    /*
     * Draft and approval-pending bills
     * do not affect stock.
     *
     * Linked products are checked again
     * when the bill is approved.
     */
    if (
      status ===
      "Awaiting payment"
    ) {
      const productErrors = [];

      validItems.forEach(
        (item) => {
          if (!item.productId) {
            return;
          }

          const liveProduct =
            catalogueItems.find((product) => product.id === item.productId);

          if (!liveProduct) {
            productErrors.push(
              `${item.productName || item.description} could not be found in the product catalogue.`
            );

            return;
          }

          if (
            liveProduct.status !==
            "Active"
          ) {
            productErrors.push(
              `${liveProduct.name} is archived and cannot be added to an approved bill.`
            );
          }
        }
      );

      if (
        productErrors.length > 0
      ) {
        nextErrors.items =
          productErrors.join(" ");
      }
    }

    setErrors(nextErrors);

    return (
      Object.keys(nextErrors)
        .length === 0
    );
  };

  const handleSave = async (
    status
  ) => {
    if (
      !validateBill(status)
    ) {
      return;
    }

    setIsSaving(true);

    try {
      const validItems =
        items.filter(
          (item) =>
            String(
              item.description || ""
            ).trim() &&
            Number(item.quantity) >
              0 &&
            item.accountCode
        );

      const firstAccount =
        expenseAccounts.find(
          (account) =>
            account.code ===
            validItems[0]
              ?.accountCode
        );

      const newBill =
        await purchasesApiService.create(
          {
            billNumber:
              details.billNumber.trim(),

            supplierReference:
              details.supplierReference.trim(),

            supplierId:
              selectedSupplier.id,

            supplier:
              selectedSupplier.name,

            supplierEmail:
              selectedSupplier.email,

            supplierAddress:
              selectedSupplierAddress,

            issueDate:
              formatDisplayDate(
                details.issueDate
              ),

            dueDate:
              formatDisplayDate(
                details.dueDate
              ),

            paymentTerms:
              details.paymentTerms,

            currency:
              details.currency,

            pricingMode:
              details.pricingMode,

            category:
              details.category ||
              firstAccount?.name ||
              "",

            notes:
              details.notes.trim(),

            items:
              validItems.map(
                (item) => {
                  const liveProduct =
                    item.productId
                      ? catalogueItems.find((product) => product.id === item.productId)
                      : null;

                  const account =
                    expenseAccounts.find(
                      (
                        expenseAccount
                      ) =>
                        expenseAccount.code ===
                        item.accountCode
                    );

                  return {
                    id:
                      item.id ||
                      createRecordId(),

                    productId:
                      liveProduct?.id ||
                      null,

                    productName:
                      liveProduct?.name ||
                      item.productName ||
                      "",

                    sku:
                      liveProduct?.sku ||
                      item.sku ||
                      "",

                    itemType:
                      liveProduct?.type ||
                      item.itemType ||
                      "",

                    description:
                      String(
                        item.description ||
                          ""
                      ).trim(),

                    quantity:
                      Number(
                        item.quantity
                      ),

                    unitPrice:
                      Number(
                        item.unitPrice
                      ),

                    discountRate:
                      Number(
                        item.discountRate
                      ) || 0,

                    vatRate:
                      Number(
                        item.vatRate
                      ) || 0,
                    taxRateId: item.taxRateId || null,

                    accountCode:
                      item.accountCode,

                    accountName:
                      account?.name ||
                      item.purchaseAccount ||
                      "",

                    purchaseAccount:
                      liveProduct?.purchaseAccount ||
                      item.purchaseAccount ||
                      account?.name ||
                      "",

                    expenseAccountId: account?.id,

                    trackInventory:
                      Boolean(
                        liveProduct?.trackInventory
                      ),

                    inventoryUnitCost:
                      Number(
                        item.unitPrice
                      ) || 0,

                    stockBeforePurchase:
                      Number(
                        liveProduct?.quantityOnHand
                      ) || 0,
                  };
                }
              ),
            approve: status !== "Draft",
          }
        );

      navigate(
        `/purchases/bills/${newBill.id}`
      );
    } catch (error) {
      console.error(
        "Unable to create bill:",
        error
      );

      setErrors({
        form:
          normaliseApiError(error),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="new-invoice-page">
      <div className="invoice-back-row">
        <Link
          to="/purchases/bills"
          className="invoice-back-link"
        >
          <ArrowLeft size={17} />
          Back to bills
        </Link>
      </div>

      <PageHeader
        eyebrow="Purchases"
        title="New bill"
        description="Record supplier expenses and inventory purchases."
      />

      {errors.form && (
        <div className="invoice-form-alert">
          <TriangleAlert
            size={18}
          />

          <span>
            {errors.form}
          </span>
        </div>
      )}

      <div className="invoice-form-layout">
        <section className="invoice-form-main">
          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>
                  Supplier details
                </h2>

                <p>
                  Select the supplier and
                  enter the supplier’s
                  invoice information.
                </p>
              </div>
            </div>

            <div className="invoice-form-grid">
              <div className="invoice-form-field invoice-form-field-full">
                <label htmlFor="supplierId">
                  Supplier
                </label>

                <select
                  id="supplierId"
                  name="supplierId"
                  value={
                    details.supplierId
                  }
                  onChange={
                    handleSupplierChange
                  }
                >
                  <option value="">
                    Select supplier
                  </option>

                  {suppliers.map(
                    (supplier) => (
                      <option
                        key={supplier.id}
                        value={supplier.id}
                      >
                        {supplier.name}

                        {supplier.status ===
                        "Inactive"
                          ? " — Inactive"
                          : ""}
                      </option>
                    )
                  )}
                </select>

                {errors.supplierId && (
                  <small className="form-error-message">
                    {
                      errors.supplierId
                    }
                  </small>
                )}

                {selectedSupplier && (
                  <div className="invoice-customer-preview">
                    <strong>
                      {selectedSupplier.email ||
                        "No email address"}
                    </strong>

                    <p>
                      {selectedSupplierAddress.length >
                      0
                        ? selectedSupplierAddress.join(
                            ", "
                          )
                        : "No address provided"}
                    </p>
                  </div>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="billNumber">
                  Internal bill number
                </label>

                <input
                  id="billNumber"
                  name="billNumber"
                  value={
                    details.billNumber
                  }
                  onChange={
                    handleDetailChange
                  }
                />

                {errors.billNumber && (
                  <small className="form-error-message">
                    {
                      errors.billNumber
                    }
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="supplierReference">
                  Supplier invoice number
                </label>

                <input
                  id="supplierReference"
                  name="supplierReference"
                  value={
                    details.supplierReference
                  }
                  onChange={
                    handleDetailChange
                  }
                  placeholder="For example, SUP-INV-1001"
                />
              </div>

              <div className="invoice-form-field">
                <label htmlFor="issueDate">
                  Issue date
                </label>

                <input
                  id="issueDate"
                  name="issueDate"
                  type="date"
                  value={
                    details.issueDate
                  }
                  onChange={
                    handleDetailChange
                  }
                />

                {errors.issueDate && (
                  <small className="form-error-message">
                    {errors.issueDate}
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="dueDate">
                  Due date
                </label>

                <input
                  id="dueDate"
                  name="dueDate"
                  type="date"
                  value={
                    details.dueDate
                  }
                  onChange={
                    handleDetailChange
                  }
                />

                {errors.dueDate && (
                  <small className="form-error-message">
                    {errors.dueDate}
                  </small>
                )}
              </div>

              <div className="invoice-form-field">
                <label htmlFor="paymentTerms">
                  Payment terms
                </label>

                <select
                  id="paymentTerms"
                  name="paymentTerms"
                  value={
                    details.paymentTerms
                  }
                  onChange={
                    handleDetailChange
                  }
                >
                  {paymentTermOptions.map(
                    (term) => (
                      <option
                        key={term}
                        value={term}
                      >
                        {term}
                      </option>
                    )
                  )}
                </select>
              </div>

              <div className="invoice-form-field">
                <label htmlFor="currency">
                  Currency
                </label>

                <select
                  id="currency"
                  name="currency"
                  value={
                    details.currency
                  }
                  onChange={
                    handleDetailChange
                  }
                >
                  <option value="GBP">
                    GBP – British Pound
                  </option>

                  <option value="USD">
                    USD – US Dollar
                  </option>

                  <option value="EUR">
                    EUR – Euro
                  </option>

                  <option value="GHS">
                    GHS – Ghana Cedi
                  </option>
                </select>
              </div>

              <div className="invoice-form-field">
                <label htmlFor="pricingMode">
                  Prices are
                </label>

                <select
                  id="pricingMode"
                  name="pricingMode"
                  value={
                    details.pricingMode
                  }
                  onChange={
                    handleDetailChange
                  }
                >
                  <option value="exclusive">
                    VAT exclusive
                  </option>

                  <option value="inclusive">
                    VAT inclusive
                  </option>
                </select>
              </div>
            </div>
          </div>

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>Bill items</h2>

                <p>
                  Select products,
                  services or enter a
                  manual expense line.
                </p>
              </div>
            </div>

            {errors.items && (
              <div className="invoice-form-alert">
                <TriangleAlert
                  size={18}
                />

                <span>
                  {errors.items}
                </span>
              </div>
            )}

            <div className="invoice-items-wrapper">
              <div className="bill-items-header bill-items-header-catalogue">
                <span>Product</span>
                <span>Description</span>
                <span>
                  Expense account
                </span>
                <span>Quantity</span>
                <span>Unit price</span>
                <span>Discount</span>
                <span>VAT</span>
                <span>Total</span>
                <span />
              </div>

              {items.map((item) => {
                const selectedProduct =
                  item.productId
                    ? productMap[
                        String(
                          item.productId
                        )
                      ]
                    : null;

                const incomingQuantity =
                  item.productId
                    ? Number(
                        incomingStockByProduct[
                          String(
                            item.productId
                          )
                        ]
                      ) || 0
                    : 0;

                const currentStock =
                  Number(
                    selectedProduct
                      ?.quantityOnHand
                  ) || 0;

                const projectedStock =
                  roundQuantity(
                    currentStock +
                      incomingQuantity
                  );

                const lineTotals =
                  calculateBillTotals({
                    items: [item],

                    pricingMode:
                      details.pricingMode,
                  });

                return (
                  <div
                    key={item.id}
                    className="bill-item-row bill-item-row-catalogue"
                  >
                    <div className="bill-product-selector-cell">
                      <select
                        value={
                          item.productId
                        }
                        onChange={(
                          event
                        ) =>
                          handleProductChange(
                            item.id,
                            event.target
                              .value
                          )
                        }
                      >
                        <option value="">
                          Manual expense
                        </option>

                        {item.productId &&
                          !selectedProduct && (
                            <option
                              value={
                                item.productId
                              }
                            >
                              Linked item unavailable
                            </option>
                          )}

                        {catalogueItems.map(
                          (product) => (
                            <option
                              key={
                                product.id
                              }
                              value={
                                product.id
                              }
                            >
                              {product.name} ·{" "}
                              {product.sku}

                              {product.type ===
                              "Service"
                                ? " · Service"
                                : product.trackInventory
                                  ? ` · ${product.quantityOnHand} in stock`
                                  : " · Stock not tracked"}
                            </option>
                          )
                        )}
                      </select>

                      {selectedProduct && (
                        <div className="bill-product-meta">
                          <span>
                            {
                              selectedProduct.sku
                            }
                          </span>

                          {selectedProduct.type ===
                          "Service" ? (
                            <span className="bill-product-service-badge">
                              Service
                            </span>
                          ) : selectedProduct.trackInventory ? (
                            <span className="bill-product-stock-badge">
                              {currentStock} →{" "}
                              {projectedStock}
                            </span>
                          ) : (
                            <span className="bill-product-service-badge">
                              Stock not tracked
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <input
                      value={
                        item.description
                      }
                      placeholder="Description"
                      onChange={(event) =>
                        handleItemChange(
                          item.id,
                          "description",
                          event.target.value
                        )
                      }
                    />

                    <select
                      value={
                        item.accountCode
                      }
                      onChange={(event) =>
                        handleItemChange(
                          item.id,
                          "accountCode",
                          event.target.value
                        )
                      }
                    >
                      <option value="">
                        Select account
                      </option>

                      {expenseAccounts.map(
                        (account) => (
                          <option
                            key={
                              account.code
                            }
                            value={
                              account.code
                            }
                          >
                            {account.code} –{" "}
                            {account.name}
                          </option>
                        )
                      )}
                    </select>

                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      value={
                        item.quantity
                      }
                      onChange={(event) =>
                        handleItemChange(
                          item.id,
                          "quantity",
                          event.target.value
                        )
                      }
                    />

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={
                        item.unitPrice
                      }
                      onChange={(event) =>
                        handleItemChange(
                          item.id,
                          "unitPrice",
                          event.target.value
                        )
                      }
                    />

                    <div className="invoice-percentage-input">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={
                          item.discountRate
                        }
                        onChange={(event) =>
                          handleItemChange(
                            item.id,
                            "discountRate",
                            event.target.value
                          )
                        }
                      />

                      <span>%</span>
                    </div>

                    <select value={item.taxRateId || ""} onChange={(event) => {
                      const selected = taxRates.find((rate) => rate.id === event.target.value);
                      handleItemChange(item.id, "taxRateId", event.target.value);
                      handleItemChange(item.id, "vatRate", selected?.rate || 0);
                    }} aria-label="Tax rate">
                      <option value="">No tax</option>
                      {taxRates.filter((rate) => rate.effective_from <= details.issueDate
                        && (!rate.effective_to || rate.effective_to >= details.issueDate))
                        .map((rate) => <option key={rate.id} value={rate.id}>{rate.code} — {rate.name} ({rate.rate}%)</option>)}
                    </select>

                    <strong>
                      {formatCurrency(
                        lineTotals.total,
                        details.currency
                      )}
                    </strong>

                    <button
                      type="button"
                      className="invoice-remove-item"
                      disabled={
                        items.length === 1
                      }
                      onClick={() =>
                        removeItem(
                          item.id
                        )
                      }
                      aria-label="Remove bill item"
                    >
                      <Trash2
                        size={17}
                      />
                    </button>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              className="invoice-add-item-button"
              onClick={addItem}
            >
              <Plus size={17} />
              Add bill item
            </button>
          </div>

          <div className="invoice-form-card">
            <div className="invoice-form-section-header">
              <div>
                <h2>Notes</h2>

                <p>
                  Add internal
                  information about this
                  bill.
                </p>
              </div>
            </div>

            <div className="invoice-form-field">
              <label htmlFor="notes">
                Bill notes
              </label>

              <textarea
                id="notes"
                name="notes"
                rows="5"
                value={details.notes}
                onChange={
                  handleDetailChange
                }
                placeholder="Optional notes"
              />
            </div>
          </div>
        </section>

        <aside className="invoice-form-sidebar">
          <div className="invoice-total-card">
            <h2>Bill summary</h2>

            <div className="invoice-total-row">
              <span>Subtotal</span>

              <strong>
                {formatCurrency(
                  totals.subtotal,
                  details.currency
                )}
              </strong>
            </div>

            {totals.discount > 0 && (
              <div className="invoice-total-row">
                <span>Discount</span>

                <strong>
                  -
                  {formatCurrency(
                    totals.discount,
                    details.currency
                  )}
                </strong>
              </div>
            )}

            <div className="invoice-total-row">
              <span>VAT</span>

              <strong>
                {formatCurrency(
                  totals.vat,
                  details.currency
                )}
              </strong>
            </div>

            <div className="invoice-total-row invoice-total-grand">
              <span>Total</span>

              <strong>
                {formatCurrency(
                  totals.total,
                  details.currency
                )}
              </strong>
            </div>
          </div>

          <div className="invoice-action-card">
            <button
              type="button"
              className="invoice-save-draft-button"
              disabled={isSaving}
              onClick={() =>
                handleSave("Draft")
              }
            >
              <Save size={18} />

              {isSaving
                ? "Saving..."
                : "Save draft"}
            </button>

            <button
              type="button"
              className="invoice-secondary-button invoice-full-width-button"
              disabled={isSaving}
              onClick={() =>
                handleSave(
                  "Awaiting approval"
                )
              }
            >
              <Send size={18} />

              {isSaving
                ? "Submitting..."
                : "Submit for approval"}
            </button>

            <button
              type="button"
              className="invoice-approve-button"
              disabled={isSaving}
              onClick={() =>
                handleSave(
                  "Awaiting payment"
                )
              }
            >
              <CheckCircle2
                size={18}
              />

              {isSaving
                ? "Approving..."
                : "Approve bill"}
            </button>

            <p>
              Draft and approval-pending
              bills do not change stock.
              Approved bills add tracked
              product quantities to
              inventory.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default NewBillPage;
