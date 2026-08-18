export const creditNotes = [
  {
    id: 1,
    creditNoteNumber: "CN-1002",
    customer: "Bluewave Consulting",
    customerEmail: "accounts@bluewaveconsulting.co.uk",
    customerAddress: [
      "18 Victoria Street",
      "Manchester",
      "M1 4AB",
      "United Kingdom",
    ],
    sourceInvoiceId: 1,
    sourceInvoiceNumber: "INV-1008",
    issueDate: "22 Jul 2026",
    reference: "SERVICE-ADJUSTMENT",
    reason: "Service adjustment",
    status: "Applied",
    currency: "GBP",
    pricingMode: "exclusive",
    amountApplied: 180,
    applications: [
      {
        id: "application-cn-1002-1",
        invoiceId: 1,
        invoiceNumber: "INV-1008",
        amount: 180,
        appliedDate: "22 Jul 2026",
      },
    ],
    items: [
      {
        id: 1,
        description: "VAT return preparation adjustment",
        quantity: 1,
        unitPrice: 150,
        discountRate: 0,
        vatRate: 20,
      },
    ],
    notes:
      "Credit issued following an adjustment to the VAT return preparation charge.",
    activity: [
      {
        id: 1,
        title: "Credit applied",
        description:
          "£180.00 was applied to invoice INV-1008.",
        date: "22 Jul 2026 at 14:20",
      },
      {
        id: 2,
        title: "Credit note approved",
        description:
          "Credit note was approved and made available for allocation.",
        date: "22 Jul 2026 at 14:15",
      },
    ],
  },
  {
    id: 2,
    creditNoteNumber: "CN-1001",
    customer: "Northstar Retail",
    customerEmail: "finance@northstarretail.co.uk",
    customerAddress: [
      "24 Market Road",
      "Leeds",
      "LS1 6DT",
      "United Kingdom",
    ],
    sourceInvoiceId: 2,
    sourceInvoiceNumber: "INV-1007",
    issueDate: "21 Jul 2026",
    reference: "PAYROLL-CORRECTION",
    reason: "Incorrect charge",
    status: "Part applied",
    currency: "GBP",
    pricingMode: "exclusive",
    amountApplied: 120,
    applications: [
      {
        id: "application-cn-1001-1",
        invoiceId: 2,
        invoiceNumber: "INV-1007",
        amount: 120,
        appliedDate: "21 Jul 2026",
      },
    ],
    items: [
      {
        id: 1,
        description: "Payroll processing correction",
        quantity: 1,
        unitPrice: 200,
        discountRate: 0,
        vatRate: 20,
      },
    ],
    notes:
      "Partial credit issued because the original payroll processing charge was incorrect.",
    activity: [
      {
        id: 1,
        title: "Credit partially applied",
        description:
          "£120.00 was applied to invoice INV-1007.",
        date: "21 Jul 2026 at 11:45",
      },
      {
        id: 2,
        title: "Credit note approved",
        description:
          "Credit note was approved and made available for allocation.",
        date: "21 Jul 2026 at 11:30",
      },
    ],
  },
  {
    id: 3,
    creditNoteNumber: "CN-1000",
    customer: "Oakfield Services",
    customerEmail: "accounts@oakfieldservices.co.uk",
    customerAddress: [
      "14 Westfield Road",
      "Sheffield",
      "S10 2AB",
      "United Kingdom",
    ],
    sourceInvoiceId: null,
    sourceInvoiceNumber: "",
    issueDate: "20 Jul 2026",
    reference: "GOODWILL-CREDIT",
    reason: "Customer goodwill",
    status: "Draft",
    currency: "GBP",
    pricingMode: "exclusive",
    amountApplied: 0,
    applications: [],
    items: [
      {
        id: 1,
        description: "Customer goodwill credit",
        quantity: 1,
        unitPrice: 100,
        discountRate: 0,
        vatRate: 20,
      },
    ],
    notes:
      "Draft goodwill credit awaiting internal approval.",
    activity: [
      {
        id: 1,
        title: "Credit note created",
        description:
          "Credit note was created as a draft.",
        date: "20 Jul 2026 at 09:40",
      },
    ],
  },
];