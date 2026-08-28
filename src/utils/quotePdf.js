import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { formatCurrency as safeFormatCurrency } from "./currency";

// Formats currency.
const formatCurrency = (
  amount,
  currency = "GBP"
) =>
  safeFormatCurrency(amount, currency, { locale: "en-GB" });

// Calculates quote totals.
const calculateQuoteTotals = (quote) =>
  (quote.items || []).reduce(
    (totals, item) => {
      const quantity =
        Number(item.quantity) || 0;
      const unitPrice =
        Number(item.unitPrice) || 0;
      const discountRate =
        Number(item.discountRate) || 0;
      const vatRate =
        Number(item.vatRate) || 0;

      const gross =
        quantity * unitPrice;

      const discount =
        gross * (discountRate / 100);

      const discounted =
        gross - discount;

      let net = discounted;
      let vat =
        discounted * (vatRate / 100);
      let total = net + vat;

      if (
        quote.pricingMode ===
        "inclusive"
      ) {
        net =
          vatRate > 0
            ? discounted /
              (1 + vatRate / 100)
            : discounted;

        vat = discounted - net;
        total = discounted;
      }

      totals.subtotal += net;
      totals.discount += discount;
      totals.vat += vat;
      totals.total += total;

      return totals;
    },
    {
      subtotal: 0,
      discount: 0,
      vat: 0,
      total: 0,
    }
  );

// Downloads quote pdf.
export const downloadQuotePdf = (
  quote
) => {
  const document = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const totals =
    calculateQuoteTotals(quote);

  const currency =
    quote.currency || "GBP";

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
  document.text("AC", 23, 27.5);

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
    "QUOTE",
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
    quote.quoteNumber,
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
    "PREPARED FOR",
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
    quote.customer,
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

  (quote.customerAddress || []).forEach(
    (line) => {
      document.text(
        line,
        18,
        addressY
      );

      addressY += 5;
    }
  );

  if (quote.customerEmail) {
    document.text(
      quote.customerEmail,
      18,
      addressY
    );
  }

  const details = [
    ["Issue date", quote.issueDate],
    ["Expiry date", quote.expiryDate],
    [
      "Reference",
      quote.reference || "—",
    ],
    ["Currency", currency],
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
    quote.items || []
  ).map((item) => {
    const quantity =
      Number(item.quantity) || 0;
    const price =
      Number(item.unitPrice) || 0;
    const discountRate =
      Number(item.discountRate) || 0;
    const vatRate =
      Number(item.vatRate) || 0;

    const gross =
      quantity * price;

    const discounted =
      gross *
      (1 - discountRate / 100);

    const total =
      quote.pricingMode ===
      "inclusive"
        ? discounted
        : discounted *
          (1 + vatRate / 100);

    return [
      item.description,
      quantity,
      formatCurrency(
        price,
        currency
      ),
      `${discountRate}%`,
      `${vatRate}%`,
      formatCurrency(
        total,
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
      textColor: [51, 65, 85],
      lineColor: [226, 232, 240],
      lineWidth: {
        bottom: 0.2,
      },
    },
    headStyles: {
      fillColor: [248, 250, 252],
      textColor: [100, 116, 139],
      fontStyle: "bold",
    },
  });

  const tableEnd =
    document.lastAutoTable?.finalY ||
    120;

  let summaryY = tableEnd + 13;

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
    "TERMS AND NOTES",
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
      quote.notes || "",
      85
    );

  document.text(
    notes,
    18,
    summaryY + 6
  );

  const totalRows = [
    ["Subtotal", totals.subtotal],
    ["VAT", totals.vat],
    ["Total", totals.total],
  ];

  totalRows.forEach(
    ([label, value], index) => {
      document.setFontSize(
        index === 2 ? 12 : 9
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
          index * 10
      );

      document.text(
        formatCurrency(
          value,
          currency
        ),
        192,
        summaryY +
          index * 10,
        {
          align: "right",
        }
      );
    }
  );

  document.save(
    `${quote.quoteNumber}.pdf`
  );
};
