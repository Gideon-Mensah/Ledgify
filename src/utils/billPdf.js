// Build a printable supplier bill from backend-authoritative lines and totals.

import { jsPDF } from "jspdf";
import {
  autoTable,
} from "jspdf-autotable";
import { formatCurrency as safeFormatCurrency } from "./currency";
// Formats currency.
const formatCurrency = (
  amount,
  currency = "GBP"
) =>
  safeFormatCurrency(amount, currency, { locale: "en-GB" });

// Downloads bill pdf.
export const downloadBillPdf = (
  bill
) => {
  if (!bill) {
    throw new Error(
      "Bill is required."
    );
  }

  const document = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const currency =
    bill.currency || "GBP";

  document.setFillColor(
    14,
    116,
    144
  );

  document.roundedRect(
    18,
    16,
    18,
    18,
    3,
    3,
    "F"
  );

  document.setTextColor(
    255,
    255,
    255
  );

  document.setFont(
    "helvetica",
    "bold"
  );

  document.setFontSize(11);

  document.text(
    "AC",
    23,
    27.5
  );

  document.setTextColor(
    15,
    23,
    42
  );

  document.setFontSize(15);

  document.text(
    "Accounting Cloud Ltd",
    41,
    22
  );

  document.setFontSize(9);

  document.setTextColor(
    100,
    116,
    139
  );

  document.setFont(
    "helvetica",
    "normal"
  );

  document.text(
    "12 Business Park",
    41,
    28
  );

  document.text(
    "Sheffield, S1 2AB",
    41,
    33
  );

  document.text(
    "United Kingdom",
    41,
    38
  );

  document.setFont(
    "helvetica",
    "bold"
  );

  document.text(
    "SUPPLIER BILL",
    192,
    20,
    {
      align: "right",
    }
  );

  document.setFontSize(20);

  document.setTextColor(
    15,
    23,
    42
  );

  document.text(
    bill.billNumber,
    192,
    29,
    {
      align: "right",
    }
  );

  document.setDrawColor(
    226,
    232,
    240
  );

  document.line(
    18,
    48,
    192,
    48
  );

  document.setFontSize(8);

  document.setTextColor(
    100,
    116,
    139
  );

  document.text(
    "SUPPLIER",
    18,
    58
  );

  document.setFontSize(11);

  document.setTextColor(
    15,
    23,
    42
  );

  document.text(
    bill.supplier,
    18,
    65
  );

  document.setFontSize(9);

  document.setFont(
    "helvetica",
    "normal"
  );

  document.setTextColor(
    71,
    85,
    105
  );

  let addressY = 71;

  (bill.supplierAddress || []).forEach(
    (line) => {
      document.text(
        String(line),
        18,
        addressY
      );

      addressY += 5;
    }
  );

  if (bill.supplierEmail) {
    document.text(
      bill.supplierEmail,
      18,
      addressY
    );
  }

  const details = [
    [
      "Supplier reference",
      bill.supplierReference || "—",
    ],
    ["Issue date", bill.issueDate],
    ["Due date", bill.dueDate],
    [
      "Payment terms",
      bill.paymentTerms || "—",
    ],
    [
      "Status",
      bill.status || "Draft",
    ],
  ];

  let detailsY = 58;

  details.forEach(
    ([label, value]) => {
      document.setFontSize(8);

      document.setTextColor(
        100,
        116,
        139
      );

      document.text(
        label,
        123,
        detailsY
      );

      document.setFontSize(9);

      document.setFont(
        "helvetica",
        "bold"
      );

      document.setTextColor(
        15,
        23,
        42
      );

      document.text(
        String(value),
        192,
        detailsY,
        {
          align: "right",
        }
      );

      detailsY += 8;
    }
  );

  const rows = (
    bill.items || []
  ).map((item) => {
    const quantity =
      Number(item.quantity) || 0;

    const unitPrice =
      Number(item.unitPrice) || 0;

    const vatRate =
      Number(item.vatRate) || 0;

    return [
      item.description,
      item.accountCode ? `${item.accountCode}${item.accountName ? ` · ${item.accountName}` : ""}` : "—",
      quantity,
      formatCurrency(
        unitPrice,
        currency
      ),
      formatCurrency(item.discountAmount, currency),
      `${vatRate}%`,
      formatCurrency(
        item.lineTotal,
        currency
      ),
    ];
  });

  autoTable(document, {
    startY: 105,
    margin: {
      left: 18,
      right: 18,
    },
    head: [
      [
        "Description",
        "Account",
        "Qty",
        "Unit price",
        "Discount",
        "Tax",
        "Total",
      ],
    ],
    body: rows,
    theme: "plain",
    styles: {
      fontSize: 8,
      cellPadding: 3.2,
      textColor: [51, 65, 85],
      lineColor: [
        226,
        232,
        240,
      ],
      lineWidth: {
        bottom: 0.2,
      },
    },
    headStyles: {
      fillColor: [
        248,
        250,
        252,
      ],
      textColor: [
        100,
        116,
        139,
      ],
      fontStyle: "bold",
    },
  });

  const tableEnd =
    document.lastAutoTable
      ?.finalY || 120;

  const summaryY =
    tableEnd + 13;

  document.setFontSize(8);

  document.setFont(
    "helvetica",
    "bold"
  );

  document.setTextColor(
    100,
    116,
    139
  );

  document.text(
    "NOTES",
    18,
    summaryY
  );

  document.setFont(
    "helvetica",
    "normal"
  );

  document.setTextColor(
    71,
    85,
    105
  );

  const notes =
    document.splitTextToSize(
      bill.notes || "No notes.",
      85
    );

  document.text(
    notes,
    18,
    summaryY + 6
  );

  const totalRows = [
    [
      "Subtotal",
      bill.subtotal,
    ],
    ["Tax", bill.taxTotal],
    ["Total", bill.total],
    [
      "Paid",
      bill.amountPaid,
    ],
    [
      "Outstanding",
      bill.amountDue,
    ],
  ];

  totalRows.forEach(
    (
      [label, value],
      index
    ) => {
      const isTotal =
        index === 2;

      document.setFontSize(
        isTotal ? 11 : 9
      );

      document.setFont(
        "helvetica",
        "bold"
      );

      document.setTextColor(
        15,
        23,
        42
      );

      document.text(
        label,
        126,
        summaryY + index * 9
      );

      document.text(
        formatCurrency(
          value,
          currency
        ),
        192,
        summaryY + index * 9,
        {
          align: "right",
        }
      );
    }
  );

  document.save(
    `${String(bill.billNumber || "bill").replace(/[^a-z0-9._-]+/gi, "-")}.pdf`
  );
};
