import { jsPDF } from "jspdf";
import {
  autoTable,
} from "jspdf-autotable";
import {
  calculateDocumentTotals,
} from "./creditNoteCalculations";

// Formats currency.
const formatCurrency = (
  amount,
  currency = "GBP"
) =>
  new Intl.NumberFormat(
    "en-GB",
    {
      style: "currency",
      currency,
    }
  ).format(Number(amount) || 0);

// Downloads credit note pdf.
export const downloadCreditNotePdf = (
  creditNote
) => {
  if (!creditNote) {
    throw new Error(
      "Credit note is required."
    );
  }

  const document = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const totals =
    calculateDocumentTotals(
      creditNote
    );

  const currency =
    creditNote.currency || "GBP";

  const amountApplied =
    Math.min(
      Number(
        creditNote.amountApplied
      ) || 0,
      totals.total
    );

  const availableCredit =
    Math.max(
      totals.total -
        amountApplied,
      0
    );

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
    "CREDIT NOTE",
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
    creditNote.creditNoteNumber,
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
    "CREDIT TO",
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
    creditNote.customer,
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

  (
    creditNote.customerAddress ||
    []
  ).forEach((line) => {
    document.text(
      String(line),
      18,
      addressY
    );

    addressY += 5;
  });

  if (
    creditNote.customerEmail
  ) {
    document.text(
      creditNote.customerEmail,
      18,
      addressY
    );
  }

  const details = [
    [
      "Issue date",
      creditNote.issueDate,
    ],
    [
      "Invoice",
      creditNote.sourceInvoiceNumber ||
        "—",
    ],
    [
      "Reference",
      creditNote.reference || "—",
    ],
    [
      "Reason",
      creditNote.reason || "—",
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
        125,
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

      detailsY += 9;
    }
  );

  const rows = (
    creditNote.items || []
  ).map((item) => {
    const lineTotals =
      calculateDocumentTotals({
        items: [item],
        pricingMode:
          creditNote.pricingMode,
      });

    return [
      item.description,
      Number(item.quantity) ||
        0,
      formatCurrency(
        item.unitPrice,
        currency
      ),
      `${
        Number(
          item.discountRate
        ) || 0
      }%`,
      `${
        Number(item.vatRate) ||
        0
      }%`,
      formatCurrency(
        lineTotals.total,
        currency
      ),
    ];
  });

  autoTable(document, {
    startY: 102,
    margin: {
      left: 18,
      right: 18,
    },
    head: [
      [
        "Description",
        "Qty",
        "Unit price",
        "Discount",
        "VAT",
        "Total",
      ],
    ],
    body: rows,
    theme: "plain",
    styles: {
      fontSize: 8.5,
      cellPadding: 3.5,
      textColor: [
        51,
        65,
        85,
      ],
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
    "REASON AND NOTES",
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
      `${creditNote.reason || ""}${
        creditNote.notes
          ? `\n\n${creditNote.notes}`
          : ""
      }`,
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
      totals.subtotal,
    ],
    ["VAT", totals.vat],
    [
      "Credit total",
      totals.total,
    ],
    [
      "Applied",
      amountApplied,
    ],
    [
      "Available",
      availableCredit,
    ],
  ];

  totalRows.forEach(
    (
      [label, value],
      index
    ) => {
      const isMainTotal =
        index === 2;

      document.setFontSize(
        isMainTotal ? 11 : 9
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
        summaryY +
          index * 9
      );

      document.text(
        formatCurrency(
          value,
          currency
        ),
        192,
        summaryY +
          index * 9,
        {
          align: "right",
        }
      );
    }
  );

  document.save(
    `${creditNote.creditNoteNumber}.pdf`
  );
};