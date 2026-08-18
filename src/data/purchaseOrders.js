export const purchaseOrders = [
  {
    id: 1,
    orderNumber: "PO-1006",
    supplierId: 1,
    supplier: "Sheffield Office Supplies",
    supplierEmail:
      "accounts@sheffieldofficesupplies.co.uk",
    supplierAddress: [
      "22 Industrial Road",
      "Sheffield",
      "S9 1AB",
      "United Kingdom",
    ],
    orderDate: "18 Jul 2026",
    expectedDeliveryDate: "29 Jul 2026",
    status: "Sent",
    currency: "GBP",
    pricingMode: "exclusive",
    supplierReference: "Q-4821",
    deliveryAddress: [
      "Ledgify Demo Ltd",
      "12 Business Park",
      "Sheffield",
      "S1 2AB",
      "United Kingdom",
    ],
    items: [
      {
        id: 1,
        description: "A4 printer paper",
        quantity: 20,
        unitPrice: 18,
        discountRate: 0,
        vatRate: 20,
        accountCode: "420",
        quantityReceived: 0,
      },
      {
        id: 2,
        description: "Black toner cartridges",
        quantity: 4,
        unitPrice: 75,
        discountRate: 5,
        vatRate: 20,
        accountCode: "420",
        quantityReceived: 0,
      },
    ],
    notes:
      "Please deliver to the main reception.",
    convertedBillId: null,
    activity: [
      {
        id: 1,
        title: "Purchase order sent",
        description:
          "The purchase order was marked as sent to the supplier.",
        date: "18 Jul 2026 at 14:25",
      },
      {
        id: 2,
        title: "Purchase order approved",
        description:
          "The purchase order was approved.",
        date: "18 Jul 2026 at 14:10",
      },
    ],
  },
  {
    id: 2,
    orderNumber: "PO-1005",
    supplierId: 2,
    supplier: "Northstar Cloud Services",
    supplierEmail:
      "billing@northstarcloud.co.uk",
    supplierAddress: [
      "8 Technology Park",
      "Leeds",
      "LS1 4DT",
      "United Kingdom",
    ],
    orderDate: "15 Jul 2026",
    expectedDeliveryDate: "15 Jul 2026",
    status: "Approved",
    currency: "GBP",
    pricingMode: "exclusive",
    supplierReference: "",
    deliveryAddress: [
      "Ledgify Demo Ltd",
      "12 Business Park",
      "Sheffield",
      "S1 2AB",
      "United Kingdom",
    ],
    items: [
      {
        id: 1,
        description: "Annual cloud hosting package",
        quantity: 1,
        unitPrice: 1200,
        discountRate: 0,
        vatRate: 20,
        accountCode: "438",
        quantityReceived: 0,
      },
    ],
    notes:
      "Annual infrastructure renewal.",
    convertedBillId: null,
    activity: [
      {
        id: 1,
        title: "Purchase order approved",
        description:
          "The purchase order was approved.",
        date: "15 Jul 2026 at 11:40",
      },
    ],
  },
  {
    id: 3,
    orderNumber: "PO-1004",
    supplierId: 5,
    supplier: "Creative Studio Ltd",
    supplierEmail:
      "finance@creativestudio.co.uk",
    supplierAddress: [
      "16 Design Court",
      "London",
      "EC1A 2AB",
      "United Kingdom",
    ],
    orderDate: "12 Jul 2026",
    expectedDeliveryDate: "02 Aug 2026",
    status: "Awaiting approval",
    currency: "GBP",
    pricingMode: "exclusive",
    supplierReference: "DESIGN-Q-209",
    deliveryAddress: [
      "Ledgify Demo Ltd",
      "12 Business Park",
      "Sheffield",
      "S1 2AB",
      "United Kingdom",
    ],
    items: [
      {
        id: 1,
        description: "Website redesign services",
        quantity: 1,
        unitPrice: 1800,
        discountRate: 10,
        vatRate: 20,
        accountCode: "400",
        quantityReceived: 0,
      },
    ],
    notes:
      "Subject to management approval.",
    convertedBillId: null,
    activity: [
      {
        id: 1,
        title: "Submitted for approval",
        description:
          "The purchase order was submitted for approval.",
        date: "12 Jul 2026 at 16:20",
      },
    ],
  },
  {
    id: 4,
    orderNumber: "PO-1003",
    supplierId: 6,
    supplier: "Oakfield Maintenance",
    supplierEmail:
      "accounts@oakfieldmaintenance.co.uk",
    supplierAddress: [
      "29 Service Lane",
      "Sheffield",
      "S6 3AB",
      "United Kingdom",
    ],
    orderDate: "20 Jul 2026",
    expectedDeliveryDate: "30 Jul 2026",
    status: "Draft",
    currency: "GBP",
    pricingMode: "exclusive",
    supplierReference: "",
    deliveryAddress: [
      "Ledgify Demo Ltd",
      "12 Business Park",
      "Sheffield",
      "S1 2AB",
      "United Kingdom",
    ],
    items: [
      {
        id: 1,
        description: "Air conditioning maintenance",
        quantity: 1,
        unitPrice: 380,
        discountRate: 0,
        vatRate: 20,
        accountCode: "473",
        quantityReceived: 0,
      },
    ],
    notes:
      "Draft awaiting review.",
    convertedBillId: null,
    activity: [
      {
        id: 1,
        title: "Purchase order created",
        description:
          "The purchase order was saved as a draft.",
        date: "20 Jul 2026 at 09:15",
      },
    ],
  },
  {
    id: 5,
    orderNumber: "PO-1002",
    supplierId: 4,
    supplier: "Northern Energy",
    supplierEmail:
      "business@northernenergy.co.uk",
    supplierAddress: [
      "45 Energy House",
      "Newcastle",
      "NE1 7AB",
      "United Kingdom",
    ],
    orderDate: "10 Jun 2026",
    expectedDeliveryDate: "20 Jun 2026",
    status: "Closed",
    currency: "GBP",
    pricingMode: "exclusive",
    supplierReference: "ENERGY-2026-19",
    deliveryAddress: [
      "Ledgify Demo Ltd",
      "12 Business Park",
      "Sheffield",
      "S1 2AB",
      "United Kingdom",
    ],
    items: [
      {
        id: 1,
        description: "Electrical inspection",
        quantity: 1,
        unitPrice: 450,
        discountRate: 0,
        vatRate: 20,
        accountCode: "445",
        quantityReceived: 1,
      },
    ],
    notes:
      "Order completed and billed.",
    convertedBillId: 4,
    activity: [
      {
        id: 1,
        title: "Purchase order closed",
        description:
          "The purchase order was fully received and converted to a bill.",
        date: "25 Jun 2026 at 11:40",
      },
    ],
  },
  {
    id: 6,
    orderNumber: "PO-1001",
    supplierId: 7,
    supplier: "Westmoor Consulting",
    supplierEmail:
      "accounts@westmoorconsulting.co.uk",
    supplierAddress: [
      "4 Riverside Court",
      "Sheffield",
      "S3 8AB",
      "United Kingdom",
    ],
    orderDate: "02 Jun 2026",
    expectedDeliveryDate: "16 Jun 2026",
    status: "Cancelled",
    currency: "GBP",
    pricingMode: "exclusive",
    supplierReference: "",
    deliveryAddress: [
      "Ledgify Demo Ltd",
      "12 Business Park",
      "Sheffield",
      "S1 2AB",
      "United Kingdom",
    ],
    items: [
      {
        id: 1,
        description: "Business consulting services",
        quantity: 3,
        unitPrice: 300,
        discountRate: 0,
        vatRate: 20,
        accountCode: "477",
        quantityReceived: 0,
      },
    ],
    notes:
      "Cancelled before work commenced.",
    convertedBillId: null,
    activity: [
      {
        id: 1,
        title: "Purchase order cancelled",
        description:
          "The purchase order was cancelled.",
        date: "05 Jun 2026 at 10:30",
      },
    ],
  },
];