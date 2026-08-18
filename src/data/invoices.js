export const invoices = [
  {
    id: 1,
    invoiceNumber: "INV-1008",
    customer: "Bluewave Consulting",
    amountPaid: 2436,
    payments: [
      {
        id: "payment-inv-1008-1",
        amount: 2436,
        paymentDate: "2026-07-20",
        bankAccount: "Business current account",
        paymentMethod: "Bank transfer",
        reference: "INV-1008",
        notes: "Full invoice payment",
        createdAt: "2026-07-20T10:42:00.000Z",
      },
    ],
    customerEmail: "accounts@bluewaveconsulting.co.uk",
    customerAddress: [
      "18 Victoria Street",
      "Manchester",
      "M1 4AB",
      "United Kingdom",
    ],
    issueDate: "17 Jul 2026",
    dueDate: "31 Jul 2026",
    reference: "CONSULT-JUL-26",
    status: "Paid",
    currency: "GBP",
    items: [
      {
        id: 1,
        description: "Monthly bookkeeping",
        quantity: 4,
        unitPrice: 350,
        vatRate: 20,
      },
      {
        id: 2,
        description: "VAT return preparation",
        quantity: 1,
        unitPrice: 180,
        vatRate: 20,
      },
      {
        id: 3,
        description: "Accounting consultation",
        quantity: 3,
        unitPrice: 150,
        vatRate: 20,
      },
    ],
    notes:
      "Thank you for your business. Payment should be made using the invoice number as the reference.",
    activity: [
      {
        id: 1,
        title: "Payment received",
        description: "Full payment of £2,436.00 was recorded.",
        date: "20 Jul 2026 at 10:42",
      },
      {
        id: 2,
        title: "Invoice emailed",
        description:
          "Invoice was emailed to accounts@bluewaveconsulting.co.uk.",
        date: "17 Jul 2026 at 14:15",
      },
      {
        id: 3,
        title: "Invoice approved",
        description:
          "Invoice was approved and marked as awaiting payment.",
        date: "17 Jul 2026 at 14:10",
      },
      {
        id: 4,
        title: "Invoice created",
        description: "Invoice was created as a draft.",
        date: "17 Jul 2026 at 13:55",
      },
    ],
  },
  {
    id: 2,
    invoiceNumber: "INV-1007",
    customer: "Northstar Retail",
    amountPaid: 0,
    payments: [],
    customerEmail: "finance@northstarretail.co.uk",
    customerAddress: [
      "24 Market Road",
      "Leeds",
      "LS1 6DT",
      "United Kingdom",
    ],
    issueDate: "16 Jul 2026",
    dueDate: "30 Jul 2026",
    reference: "NSR-2026-07",
    status: "Awaiting payment",
    currency: "GBP",
    items: [
      {
        id: 1,
        description: "Monthly bookkeeping",
        quantity: 4,
        unitPrice: 350,
        vatRate: 20,
      },
      {
        id: 2,
        description: "Payroll processing",
        quantity: 1,
        unitPrice: 200,
        vatRate: 20,
      },
    ],
    notes:
      "Payment is due within 14 days. Please use the invoice number as your payment reference.",
    activity: [
      {
        id: 1,
        title: "Invoice emailed",
        description:
          "Invoice was emailed to finance@northstarretail.co.uk.",
        date: "16 Jul 2026 at 12:30",
      },
      {
        id: 2,
        title: "Invoice approved",
        description:
          "Invoice was approved and marked as awaiting payment.",
        date: "16 Jul 2026 at 12:25",
      },
    ],
  },
];